/**
 * Career profile: building a review, and applying what the user confirmed.
 *
 * The governing rule is that nothing reaches the profile without a decision.
 * An extraction is a draft. A profile field changes only when the user chose
 * 'replace' for it, and a section is rewritten only from the entries the user
 * left included.
 *
 * Two protections are worth calling out:
 *
 *  - MERGE, NOT OVERWRITE. Where a profile field already holds a value, the
 *    review shows both and the user picks. A resume is a snapshot of one point
 *    in time; it does not get to overwrite a newer, deliberately-set profile.
 *
 *  - NO SILENT DELETION. A section the user confirmed as empty leaves existing
 *    data alone rather than wiping it, because "the model found nothing" and
 *    "the user wants it gone" are different statements.
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hasPrismaUniqueViolation } from '@/lib/db-helpers';
import { logImportantInfo } from '@/lib/observability';
import { looseEquals, normalizeForCompare, sanitizeExtractedUrl, trimOrNull } from './normalise';
import type { CareerExtraction } from './schema';

/** Profile fields the review is allowed to write. Anything else is rejected. */
export const REVIEW_BASIC_FIELDS = [
  'fullName',
  'email',
  'phone',
  'location',
  'headline',
  'summary',
  'linkedinUrl',
  'portfolioUrl',
  'websiteUrl',
] as const;

export type ReviewBasicField = (typeof REVIEW_BASIC_FIELDS)[number];

export const basicFieldSchema = z.object({
  field: z.enum(REVIEW_BASIC_FIELDS),
  /**
   * `keep`    leave the existing profile value alone (the default when the
   *           profile already has one and the user did not choose);
   * `replace` write the value the user reviewed;
   * `clear`   deliberately blank the field.
   */
  action: z.enum(['keep', 'replace', 'clear']),
  value: z.string().max(2000).nullable(),
});

const experienceReviewSchema = z.object({
  include: z.boolean(),
  jobTitle: z.string().max(240).nullable(),
  company: z.string().max(240).nullable(),
  location: z.string().max(240).nullable(),
  startDate: z.string().max(16).nullable(),
  endDate: z.string().max(16).nullable(),
  isCurrent: z.boolean(),
  responsibilities: z.array(z.string().max(1200)).max(20),
  achievements: z.array(z.string().max(1200)).max(20),
  technologies: z.array(z.string().max(240)).max(40),
});

const educationReviewSchema = z.object({
  include: z.boolean(),
  institution: z.string().max(240).nullable(),
  qualification: z.string().max(240).nullable(),
  fieldOfStudy: z.string().max(240).nullable(),
  startDate: z.string().max(16).nullable(),
  endDate: z.string().max(16).nullable(),
  details: z.string().max(1200).nullable(),
});

const skillReviewSchema = z.object({
  include: z.boolean(),
  name: z.string().max(240),
  origin: z.enum(['STATED', 'SUPPORTED', 'INFERRED']),
});

const projectReviewSchema = z.object({
  include: z.boolean(),
  name: z.string().max(240).nullable(),
  description: z.string().max(1200).nullable(),
  role: z.string().max(240).nullable(),
  technologies: z.array(z.string().max(240)).max(30),
  startDate: z.string().max(16).nullable(),
  endDate: z.string().max(16).nullable(),
  projectUrl: z.string().max(500).nullable(),
  results: z.array(z.string().max(1200)).max(15),
});

const credentialKindSchema = z.enum([
  'CERTIFICATION',
  'LICENSE',
  'LANGUAGE',
  'AWARD',
  'PUBLICATION',
  'VOLUNTEER',
]);

const credentialReviewSchema = z.object({
  include: z.boolean(),
  kind: credentialKindSchema,
  name: z.string().max(240),
  issuer: z.string().max(240).nullable(),
  issuedDate: z.string().max(16).nullable(),
  expiresDate: z.string().max(16).nullable(),
  proficiency: z.string().max(240).nullable(),
  details: z.string().max(1200).nullable(),
});

/**
 * The reviewed payload.
 *
 * Note what is absent: userId, role, plan, careerProfileVersion-as-a-write, and
 * any other ownership or entitlement field. The server derives the identity and
 * reads the version itself; a client that posts them is ignored, not trusted.
 */
export const reviewSubmissionSchema = z.object({
  /** The profile version the review was built from, for optimistic locking. */
  expectedProfileVersion: z.number().int().min(0),
  basics: z.array(basicFieldSchema).max(REVIEW_BASIC_FIELDS.length).default([]),
  workExperience: z.array(experienceReviewSchema).max(25).default([]),
  education: z.array(educationReviewSchema).max(15).default([]),
  skills: z.array(skillReviewSchema).max(80).default([]),
  projects: z.array(projectReviewSchema).max(20).default([]),
  credentials: z.array(credentialReviewSchema).max(40).default([]),
});

export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;

export class ProfileVersionConflictError extends Error {
  readonly code = 'CONFLICT';
  readonly status = 409;

  constructor() {
    super('Your career profile changed since this review was opened. Reload and review again.');
    this.name = 'ProfileVersionConflictError';
  }
}

// ─── Review payload ────────────────────────────────────────────────────────

export type BasicFieldReview = {
  field: ReviewBasicField;
  label: string;
  current: string | null;
  candidate: string | null;
  /** True when the profile already holds something different. */
  conflict: boolean;
  evidence: CareerExtraction['workExperience'][number]['evidence'] | null;
};

const BASIC_FIELD_LABELS: Record<ReviewBasicField, string> = {
  fullName: 'Full name',
  email: 'Email on resume',
  phone: 'Phone',
  location: 'Location',
  headline: 'Headline',
  summary: 'Professional summary',
  linkedinUrl: 'LinkedIn',
  portfolioUrl: 'Portfolio',
  websiteUrl: 'Website',
};

export type ExistingProfileSnapshot = {
  fullName: string | null;
  headline: string | null;
  phone: string | null;
  summary: string | null;
  location: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  websiteUrl: string | null;
  careerProfileVersion: number;
};

/**
 * Assemble the review.
 *
 * Every field carries both sides — what the profile says today and what the
 * resume suggests — plus whether they disagree, so the UI never has to fetch
 * two endpoints and guess.
 */
export function buildReviewPayload(params: {
  extraction: CareerExtraction;
  profile: ExistingProfileSnapshot;
}): {
  version: number;
  basics: BasicFieldReview[];
  extraction: CareerExtraction;
} {
  const { extraction, profile } = params;

  const nameConflict =
    extraction.fullName !== null &&
    profile.fullName !== null &&
    !looseEquals(extraction.fullName, profile.fullName);

  const basics: BasicFieldReview[] = [
    {
      field: 'fullName',
      label: BASIC_FIELD_LABELS.fullName,
      current: profile.fullName,
      candidate: extraction.fullName,
      // A resume is a point-in-time document. A different name is not an error,
      // so it is flagged for a decision rather than resolved for the user.
      conflict: nameConflict,
      evidence: null,
    },
    {
      field: 'email',
      label: BASIC_FIELD_LABELS.email,
      current: null,
      candidate: extraction.email,
      conflict: false,
      evidence: null,
    },
    {
      field: 'phone',
      label: BASIC_FIELD_LABELS.phone,
      current: profile.phone,
      candidate: extraction.phone,
      conflict: Boolean(profile.phone && extraction.phone && !looseEquals(profile.phone, extraction.phone)),
      evidence: null,
    },
    {
      field: 'location',
      label: BASIC_FIELD_LABELS.location,
      current: profile.location,
      candidate: [extraction.city, extraction.region, extraction.country].filter(Boolean).join(', ') || null,
      conflict: Boolean(
        profile.location &&
          [extraction.city, extraction.region, extraction.country].filter(Boolean).join(', ') &&
          !looseEquals(profile.location, [extraction.city, extraction.region, extraction.country].join(', ')),
      ),
      evidence: null,
    },
    {
      field: 'headline',
      label: BASIC_FIELD_LABELS.headline,
      current: profile.headline,
      candidate: extraction.headline,
      conflict: Boolean(profile.headline && extraction.headline && !looseEquals(profile.headline, extraction.headline)),
      evidence: null,
    },
    {
      field: 'summary',
      label: BASIC_FIELD_LABELS.summary,
      current: profile.summary,
      candidate: extraction.summary,
      conflict: Boolean(profile.summary && extraction.summary && !looseEquals(profile.summary, extraction.summary)),
      evidence: null,
    },
    {
      field: 'linkedinUrl',
      label: BASIC_FIELD_LABELS.linkedinUrl,
      current: profile.linkedinUrl,
      candidate: extraction.linkedinUrl,
      conflict: Boolean(profile.linkedinUrl && extraction.linkedinUrl && profile.linkedinUrl !== extraction.linkedinUrl),
      evidence: null,
    },
    {
      field: 'portfolioUrl',
      label: BASIC_FIELD_LABELS.portfolioUrl,
      current: profile.portfolioUrl,
      candidate: extraction.portfolioUrl,
      conflict: Boolean(profile.portfolioUrl && extraction.portfolioUrl && profile.portfolioUrl !== extraction.portfolioUrl),
      evidence: null,
    },
    {
      field: 'websiteUrl',
      label: BASIC_FIELD_LABELS.websiteUrl,
      current: profile.websiteUrl,
      candidate: extraction.websiteUrl,
      conflict: Boolean(profile.websiteUrl && extraction.websiteUrl && profile.websiteUrl !== extraction.websiteUrl),
      evidence: null,
    },
  ];

  return { version: profile.careerProfileVersion, basics, extraction };
}

/** Prefill the review form from a stored extraction. */
export function extractionToReviewDefaults(extraction: CareerExtraction): ReviewSubmission {
  return {
    expectedProfileVersion: 0,
    basics: REVIEW_BASIC_FIELDS.map((field) => ({
      field,
      action: 'keep' as const,
      value: null,
    })),
    workExperience: extraction.workExperience.map((entry) => ({
      include: entry.evidence.level === 'SUPPORTED',
      jobTitle: entry.jobTitle,
      company: entry.company,
      location: entry.location,
      startDate: entry.startDate,
      endDate: entry.endDate,
      isCurrent: entry.isCurrent,
      responsibilities: entry.responsibilities,
      achievements: entry.achievements,
      technologies: entry.technologies.map((tech) => tech.name),
    })),
    education: extraction.education.map((entry) => ({
      include: entry.evidence.level === 'SUPPORTED',
      institution: entry.institution,
      qualification: entry.qualification,
      fieldOfStudy: entry.fieldOfStudy,
      startDate: entry.startDate,
      endDate: entry.endDate,
      details: entry.details,
    })),
    skills: extraction.skills.map((skill) => ({
      // An inferred skill starts UNCHECKED. Promoting a guess to a confirmed
      // skill requires the user to actively tick it.
      include: skill.origin !== 'INFERRED' && skill.evidence.level === 'SUPPORTED',
      name: skill.name,
      origin: skill.origin,
    })),
    projects: extraction.projects.map((project) => ({
      include: project.evidence.level === 'SUPPORTED',
      name: project.name,
      description: project.description,
      role: project.role,
      technologies: project.technologies,
      startDate: project.startDate,
      endDate: project.endDate,
      projectUrl: project.projectUrl,
      results: project.results,
    })),
    credentials: extraction.credentials.map((credential) => ({
      include: credential.evidence.level === 'SUPPORTED',
      kind: credential.kind,
      name: credential.name,
      issuer: credential.issuer,
      issuedDate: credential.issuedDate,
      expiresDate: credential.expiresDate,
      proficiency: credential.proficiency,
      details: credential.details,
    })),
  };
}

// ─── Applying ──────────────────────────────────────────────────────────────

type ApplyCounts = {
  basicsApplied: number;
  experienceSaved: number;
  educationSaved: number;
  skillsSaved: number;
  projectsSaved: number;
  credentialsSaved: number;
  sectionsLeftUntouched: string[];
};

/**
 * Write the confirmed review.
 *
 * One transaction, and the profile version is a compare-and-swap rather than a
 * read followed by a write: if another tab or device saved in the meantime the
 * update matches zero rows and we abort with 409 instead of clobbering it.
 */
export async function applyReviewedExtraction(params: {
  userId: string;
  extractionId: string;
  submission: ReviewSubmission;
  route: string;
}): Promise<ApplyCounts> {
  const { userId, extractionId, submission, route } = params;

  const extraction = await prisma.resumeExtraction.findFirst({
    where: { id: extractionId, userId, status: 'COMPLETED' },
  });
  if (!extraction) {
    // Same response as "does not exist" for someone else's extraction.
    const { ResumeDocumentNotFoundError } = await import('./documents');
    throw new ResumeDocumentNotFoundError();
  }

  const counts: ApplyCounts = {
    basicsApplied: 0,
    experienceSaved: 0,
    educationSaved: 0,
    skillsSaved: 0,
    projectsSaved: 0,
    credentialsSaved: 0,
    sectionsLeftUntouched: [],
  };

  const { profileFields, userName } = buildScalarUpdates(submission);
  counts.basicsApplied = Object.keys(profileFields).length + (userName !== undefined ? 1 : 0);

  const experience = submission.workExperience.filter((entry) => entry.include);
  const education = submission.education.filter((entry) => entry.include);
  const skills = dedupeByName(submission.skills.filter((skill) => skill.include));
  const projects = submission.projects.filter((project) => project.include);
  const credentials = submission.credentials.filter((credential) => credential.include);

  // Sections the user confirmed as empty are left alone rather than emptied.
  // "The model found nothing" is not the same statement as "remove these".
  if (experience.length === 0) counts.sectionsLeftUntouched.push('workExperience');
  if (education.length === 0) counts.sectionsLeftUntouched.push('education');
  if (skills.length === 0) counts.sectionsLeftUntouched.push('skills');
  if (projects.length === 0) counts.sectionsLeftUntouched.push('projects');
  if (credentials.length === 0) counts.sectionsLeftUntouched.push('credentials');

  await prisma.$transaction(async (tx) => {
    // A user who uploaded a resume during onboarding always has a profile, but
    // one created purely through a resume document might not. Create it rather
    // than reporting a version conflict that no user action could resolve.
    const profile = await tx.userProfile.upsert({
      where: { userId },
      create: { userId, careerProfileVersion: submission.expectedProfileVersion },
      update: {},
    });

    // Optimistic concurrency: only the tab holding this version may write.
    const updated = await tx.userProfile.updateMany({
      where: { userId, careerProfileVersion: submission.expectedProfileVersion },
      data: {
        ...profileFields,
        careerProfileVersion: { increment: 1 },
        careerProfileConfirmedAt: new Date(),
      },
    });
    if (updated.count === 0) throw new ProfileVersionConflictError();

    // The account name moves with a confirmed full name, but only on the same
    // compare-and-swap, so a stale tab cannot rename the account either.
    if (userName !== undefined) {
      await tx.user.update({ where: { id: userId }, data: { name: userName } });
    }

    const recordSource = async (section: string, recordId: string) =>
      tx.careerRecordSource.upsert({
        where: { section_recordId: { section, recordId } },
        create: { extractionId, userId, section, recordId },
        update: { extractionId, userId },
      });

    if (experience.length > 0) {
      await tx.careerExperience.deleteMany({ where: { profileId: profile.id } });
      for (const [index, entry] of experience.entries()) {
        const created = await tx.careerExperience.create({
          data: {
            profileId: profile.id,
            userId,
            jobTitle: trimOrNull(entry.jobTitle, 240),
            company: trimOrNull(entry.company, 240),
            location: trimOrNull(entry.location, 240),
            startDate: trimOrNull(entry.startDate, 16),
            endDate: trimOrNull(entry.isCurrent ? 'present' : entry.endDate, 16),
            isCurrent: entry.isCurrent,
            responsibilities: entry.responsibilities.filter(Boolean),
            achievements: entry.achievements.filter(Boolean),
            technologies: entry.technologies.filter(Boolean),
            sourceSection: 'Experience',
            sortOrder: index,
          },
        });
        await recordSource('experience', created.id);
      }
      counts.experienceSaved = experience.length;
    }

    if (education.length > 0) {
      await tx.careerEducation.deleteMany({ where: { profileId: profile.id } });
      for (const [index, entry] of education.entries()) {
        const created = await tx.careerEducation.create({
          data: {
            profileId: profile.id,
            userId,
            institution: trimOrNull(entry.institution, 240),
            qualification: trimOrNull(entry.qualification, 240),
            fieldOfStudy: trimOrNull(entry.fieldOfStudy, 240),
            startDate: trimOrNull(entry.startDate, 16),
            endDate: trimOrNull(entry.endDate, 16),
            details: trimOrNull(entry.details, 1200),
            sourceSection: 'Education',
            sortOrder: index,
          },
        });
        await recordSource('education', created.id);
      }
      counts.educationSaved = education.length;
    }

    if (skills.length > 0) {
      // Skills accumulate rather than replace: removing a skill the user once
      // confirmed is not something "confirm this extraction" should do.
      for (const [index, skill] of skills.entries()) {
        const created = await tx.careerSkill.upsert({
          where: { profileId_name: { profileId: profile.id, name: skill.name } },
          create: {
            profileId: profile.id,
            userId,
            name: skill.name,
            origin: skill.origin,
            confirmed: true,
            sortOrder: index,
          },
          update: { origin: skill.origin, confirmed: true },
        });
        await recordSource('skill', created.id);
      }
      counts.skillsSaved = skills.length;
    }

    if (projects.length > 0) {
      await tx.careerProject.deleteMany({ where: { profileId: profile.id } });
      for (const [index, project] of projects.entries()) {
        const created = await tx.careerProject.create({
          data: {
            profileId: profile.id,
            userId,
            name: trimOrNull(project.name, 240),
            description: trimOrNull(project.description, 1200),
            role: trimOrNull(project.role, 240),
            technologies: project.technologies.filter(Boolean),
            startDate: trimOrNull(project.startDate, 16),
            endDate: trimOrNull(project.endDate, 16),
            projectUrl: sanitizeExtractedUrl(project.projectUrl),
            results: project.results.filter(Boolean),
            sourceSection: 'Projects',
            sortOrder: index,
          },
        });
        await recordSource('project', created.id);
      }
      counts.projectsSaved = projects.length;
    }

    if (credentials.length > 0) {
      await tx.careerCredential.deleteMany({ where: { profileId: profile.id } });
      for (const [index, credential] of credentials.entries()) {
        const created = await tx.careerCredential.create({
          data: {
            profileId: profile.id,
            userId,
            kind: credential.kind,
            name: credential.name,
            issuer: trimOrNull(credential.issuer, 240),
            issuedDate: trimOrNull(credential.issuedDate, 16),
            expiresDate: trimOrNull(credential.expiresDate, 16),
            proficiency: credential.kind === 'LANGUAGE' ? trimOrNull(credential.proficiency, 240) : null,
            details: trimOrNull(credential.details, 1200),
            sourceSection: sectionLabelForCredential(credential.kind),
            sortOrder: index,
          },
        });
        await recordSource('credential', created.id);
      }
      counts.credentialsSaved = credentials.length;
    }
  });

  await logImportantInfo({
    event: 'career_profile_review_saved',
    userId,
    route,
    context: { extractionId, ...counts },
  });

  return counts;
}

function sectionLabelForCredential(kind: string): string {
  switch (kind) {
    case 'CERTIFICATION':
      return 'Certifications';
    case 'LICENSE':
      return 'Licenses';
    case 'LANGUAGE':
      return 'Languages';
    case 'AWARD':
      return 'Awards';
    case 'PUBLICATION':
      return 'Publications';
    default:
      return 'Volunteer work';
  }
}

/**
 * Translate the confirmed basic-field choices into a profile update.
 *
 * Only `replace` and `clear` change anything. A field the user left on `keep`
 * is simply absent from the update, so an existing value is never touched.
 *
 * `email` is deliberately not writable here. The signed-in address is the one
 * that receives verification and password-reset mail; letting a resume analysis
 * change it would turn a document into an account-takeover primitive.
 */
function buildScalarUpdates(submission: ReviewSubmission): {
  profileFields: Record<string, unknown>;
  userName: string | null | undefined;
} {
  const profileFields: Record<string, unknown> = {};
  let userName: string | null | undefined;

  for (const choice of submission.basics) {
    if (choice.action === 'keep') continue;

    if (choice.action === 'clear') {
      if (choice.field === 'fullName') userName = null;
      else if (choice.field !== 'email') profileFields[choice.field] = null;
      continue;
    }

    const value = trimOrNull(choice.value, 2000);

    switch (choice.field) {
      case 'fullName':
        userName = value;
        break;
      case 'email':
        break;
      case 'linkedinUrl':
        profileFields.linkedinUrl = sanitizeExtractedUrl(value);
        break;
      case 'portfolioUrl':
        profileFields.portfolioUrl = sanitizeExtractedUrl(value);
        break;
      case 'websiteUrl':
        profileFields.websiteUrl = sanitizeExtractedUrl(value);
        break;
      default:
        profileFields[choice.field] = value;
    }
  }

  return { profileFields, userName };
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;
    const key = normalizeForCompare(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, name });
  }
  return out;
}

/** Read the confirmed profile for display. Ownership is derived, not requested. */
export async function getCareerProfile(userId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    include: {
      experiences: { orderBy: { sortOrder: 'asc' } },
      education: { orderBy: { sortOrder: 'asc' } },
      skills: { orderBy: [{ confirmed: 'desc' }, { sortOrder: 'asc' }] },
      projects: { orderBy: { sortOrder: 'asc' } },
      credentials: { orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] },
    },
  });
  return profile;
}