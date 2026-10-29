/**
 * Source-of-truth context: what we send, and what we will check against.
 *
 * This module implements the brief's source hierarchy literally, in the order
 * given, and refuses to blur the lines between a verified fact and a suggestion:
 *
 *   1. User-confirmed structured career profile
 *   2. Selected saved resume or tailored version
 *   3. The user's own job record and job description
 *   4. A valid AI job-intelligence result
 *   5. Actual application stage, dates and associated contacts
 *   6. User-provided instructions and confirmed context
 *   7. An existing user-authored draft, when explicitly selected
 *
 * Three rules do most of the work here:
 *
 *  - THE RAW RESUME FILE IS NEVER SENT. Resume Intelligence already produced a
 *    structured, user-reviewed profile. Re-uploading the whole document for
 *    every letter would be a larger privacy exposure than this task needs, and
 *    it would be paying to re-derive facts we already hold. A built
 *    `StructuredResume` is different — it is a document the user composed and
 *    owns, so its text is fair game when explicitly selected.
 *
 *  - A JOB ANALYSIS IS NOT A FACT ABOUT THE EMPLOYER. It is the model's reading
 *    of third-party text. It is passed as labelled context and is deliberately
 *    excluded from `QUOTABLE_SOURCES`, so nothing can cite it as evidence.
 *
 *  - NOTHING IS INVENTED FROM A NAME OR A TITLE. If the profile is empty, this
 *    says so, and `completeness` drives an honest limitation rather than a
 *    confident-sounding thin draft.
 *
 * Fields deliberately excluded: email, phone, account identifiers, the user's
 * resume blob URL. A letter needs a name and a career, not contact details, and
 * the previous release already established that the address on a resume must not
 * leak through an unrelated path.
 */

import { prisma } from '@/lib/prisma';
import { getResume } from '@/lib/resume-builder/documents';
import type { ResumeContent } from '@/lib/resume-builder/schema';
import {
  MATERIAL_MAX_JOB_CHARS,
  MATERIAL_MAX_PRIOR_CONTEXT_CHARS,
  MATERIAL_MAX_PRIOR_MATERIALS,
  MATERIAL_MAX_PRIOR_MATERIAL_CHARS,
  MATERIAL_MAX_PROFILE_CHARS,
  MATERIAL_MAX_RESUME_CHARS,
} from './limits';
import {
  APPLIED_STATUSES,
  MATERIAL_TYPE_META,
  type MaterialType,
} from './materials';
import { getStoredMaterialContent } from './wire';

/** What the model is allowed to know, and what verification checks against. */
export type CandidateFacts = {
  /** Full name, for the sign-off. Empty when unknown — never invented. */
  fullName: string;
  /** Verbatim blocks that must be re-quoted before anything is stored. */
  profileText: string;
  /** Normalised skill names for capability cross-checking. */
  skillNames: string[];
  /** Normalised employers, institutions and credential issuers. */
  organisationNames: string[];
  /** Normalised job titles held. */
  jobTitles: string[];
  /** Normalised technologies across experience and projects. */
  technologies: string[];
  /** Every number appearing anywhere in the profile, as written. */
  numbers: string[];
  /** True when the user reviewed and confirmed this profile. */
  confirmed: boolean;
  /** `UserProfile.careerProfileVersion`. Feeds staleness and the fingerprint. */
  careerProfileVersion: number;
};

export type JobFacts = {
  id: string;
  title: string;
  company: string;
  location: string;
  remoteType: string;
  status: string;
  dateApplied: Date | null;
  nextFollowUp: Date | null;
  /** The employer's posting text. Untrusted input. */
  description: string;
  /** Whether there is enough description to personalise against. */
  hasDescription: boolean;
  /** Whether the description was cut before being sent. */
  truncated: boolean;
  /** Contacts the user has actually recorded against this job. */
  contacts: Array<{ name: string; title: string; company: string; relationshipType: string }>;
  /** Interviews the user has actually recorded against this job. */
  interviews: Array<{ scheduledAt: string; stage: string; type: string }>;
  /** When the row last changed, so reuse can be invalidated honestly. */
  updatedAt: Date;
};

export type ApplicationContext = {
  /** What we can honestly claim about this application right now. */
  stage: 'NONE' | 'SUBMITTED' | 'INTERVIEW_SCHEDULED' | 'INTERVIEW_RECORDED';
  /** True when the pipeline says this application was submitted. */
  hasApplied: boolean;
  /** True when an interview is actually recorded. */
  hasInterview: boolean;
  /** The most recent recorded interview, if any. */
  latestInterview: JobFacts['interviews'][number] | null;
};

export type ResumeFacts = {
  id: string;
  name: string;
  /** Text of the user's own built resume. Bounded before use. */
  text: string;
  truncated: boolean;
  /** True when the career profile has moved on since this resume was built. */
  stale: boolean;
  /** Profile version this resume was built from, for the staleness check. */
  sourceProfileVersion: number | null;
  /** Candidate claims that can be verified against this explicitly selected resume. */
  evidence: {
    numbers: string[];
    organisationNames: string[];
    jobTitles: string[];
    technologies: string[];
    skillNames: string[];
  };
};

/**
 * An earlier material for the SAME job, included so a new draft can continue
 * the application's voice instead of starting from nothing.
 *
 * It is deliberately not candidate evidence: `verify.ts` never receives it as a
 * source, and the prompt states that it may not add a personal fact. A cover
 * letter that once overstated something must not become the reason a follow-up
 * repeats it.
 */
export type PriorMaterialFacts = {
  id: string;
  type: MaterialType;
  label: string;
  title: string;
  subject: string | null;
  status: string;
  updatedAt: Date;
  /** Bounded text, already clipped by the context builder. */
  content: string;
};

export type MaterialContext = {
  type: MaterialType;
  candidate: CandidateFacts;
  /** Null for a material legitimately written without a target role. */
  job: JobFacts | null;
  application: ApplicationContext;
  /** Null unless the user explicitly selected a saved resume. */
  resume: ResumeFacts | null;
  /** Labeled summary of a valid saved job analysis. Never treated as fact. */
  intelligence: { summary: string; category: string } | null;
  /**
   * Earlier materials for this job, excluding the type being generated. The
   * exclusion is intentional: asking for another cover letter should reuse the
   * cover letter draft, not feed it back to itself as "history".
   */
  priorMaterials: PriorMaterialFacts[];
  /** Fields we genuinely lack, in user-facing words. */
  missingInputs: string[];
  completeness: 'COMPLETE' | 'PARTIAL' | 'MINIMAL';
};

function tidy(value: string | null | undefined, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Collapse whitespace but PRESERVE line structure. */
function tidyMultiline(value: string | null | undefined, max = 4000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function pushLine(lines: string[], label: string, value: string | null | undefined): void {
  const clean = tidy(value);
  if (clean) lines.push(`${label}: ${clean}`);
}

function pushList(lines: string[], label: string, values: readonly string[]): void {
  const cleaned = values
    .map((value) => tidy(value, 120))
    .filter((value): value is string => Boolean(value));
  if (cleaned.length) lines.push(`${label}: ${cleaned.join(', ')}`);
}

/**
 * Every number written anywhere in the candidate's own records.
 *
 * This is what makes the numeric fabrication scan possible: "8 years" survives
 * if the profile says 8, and "10 years" cannot if it does not.
 */
function collectNumbers(...sources: string[]): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    if (typeof source !== 'string') continue;
    for (const match of source.matchAll(/\d[\d,.]*\s*%?/g)) {
      const value = match[0].trim();
      if (value) found.add(value);
    }
  }
  return [...found];
}

// ─── Candidate ──────────────────────────────────────────────────────────────

export async function buildCandidateFacts(userId: string): Promise<CandidateFacts> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      headline: true,
      summary: true,
      location: true,
      careerProfileConfirmedAt: true,
      careerProfileVersion: true,
      skills: { select: { name: true } },
      experiences: {
        select: {
          jobTitle: true,
          company: true,
          startDate: true,
          endDate: true,
          isCurrent: true,
          responsibilities: true,
          achievements: true,
          technologies: true,
        },
        orderBy: { sortOrder: 'asc' },
        take: 12,
      },
      projects: {
        select: { name: true, role: true, description: true, technologies: true, results: true },
        take: 6,
      },
      education: {
        select: { qualification: true, fieldOfStudy: true, institution: true, endDate: true },
        take: 6,
      },
      credentials: { select: { kind: true, name: true, issuer: true } , take: 12 },
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const lines: string[] = [];
  const organisationNames: string[] = [];
  const jobTitles: string[] = [];
  const technologies: string[] = [];
  const numericSources: string[] = [];

  if (profile?.careerProfileConfirmedAt) {
    lines.push(
      'The candidate has a CONFIRMED career profile. The facts below are ones they reviewed and kept, and may be stated as fact.',
    );
  } else if ((profile?.skills.length ?? 0) > 0 || (profile?.experiences.length ?? 0) > 0) {
    lines.push(
      'The candidate has saved career data that has NOT been confirmed by them. Treat it as indicative, and do not present it as a verified fact.',
    );
  }

  if (profile?.headline) pushLine(lines, 'Professional headline', profile.headline);
  if (profile?.summary) lines.push(`Summary they wrote: ${tidyMultiline(profile.summary, 600)}`);
  if (profile?.location) pushLine(lines, 'Location', profile.location);

  const skillNames = (profile?.skills ?? []).map((s) => s.name).filter(Boolean);
  pushList(lines, 'Skills', skillNames);

  for (const entry of profile?.experiences ?? []) {
    const title = tidy(entry.jobTitle);
    if (!title) continue;
    jobTitles.push(title);
    const company = tidy(entry.company);
    if (company) organisationNames.push(company);

    const period = [tidy(entry.startDate, 40), entry.isCurrent ? 'Present' : tidy(entry.endDate, 40)]
      .filter(Boolean)
      .join(' – ');

    const parts = [`- ${title}${company ? ` at ${company}` : ''}${period ? ` (${period})` : ''}`];
    const responsibilities = entry.responsibilities.map((r) => tidy(r, 200)).filter(Boolean) as string[];
    const achievements = entry.achievements.map((a) => tidy(a, 200)).filter(Boolean) as string[];
    if (responsibilities.length) parts.push(`  responsibilities: ${responsibilities.join('; ')}`);
    if (achievements.length) parts.push(`  achievements: ${achievements.join('; ')}`);
    if (entry.technologies.length) {
      const techs = entry.technologies.map((t) => tidy(t, 60)).filter(Boolean) as string[];
      if (techs.length) {
        technologies.push(...techs);
        parts.push(`  technologies: ${techs.join(', ')}`);
      }
    }
    lines.push(parts.join('\n'));
    numericSources.push(...responsibilities, ...achievements);
  }

  for (const project of profile?.projects ?? []) {
    const name = tidy(project.name);
    if (!name) continue;
    const results = project.results.map((r) => tidy(r, 200)).filter(Boolean) as string[];
    if (project.technologies.length) technologies.push(...project.technologies);
    const detail = [tidy(project.role, 80), tidy(project.description, 300), results.length ? `results: ${results.join('; ')}` : null]
      .filter(Boolean)
      .join(' — ');
    lines.push(`- Project "${name}"${detail ? `: ${detail}` : ''}`);
    numericSources.push(...results);
  }

  for (const entry of profile?.education ?? []) {
    const qualification = tidy(entry.qualification);
    if (!qualification) continue;
    const institution = tidy(entry.institution);
    if (institution) organisationNames.push(institution);
    lines.push(
      `- Education: ${qualification}${tidy(entry.fieldOfStudy, 80) ? ` in ${tidy(entry.fieldOfStudy, 80)}` : ''}${institution ? `, ${institution}` : ''}`,
    );
  }

  for (const credential of profile?.credentials ?? []) {
    lines.push(`- ${tidy(credential.kind, 40) ?? 'Credential'}: ${tidy(credential.name, 120)}`);
    const issuer = tidy(credential.issuer);
    if (issuer) organisationNames.push(issuer);
  }

  if (skillNames.length) numericSources.push(...skillNames);

  return {
    fullName: tidy(user?.name, 120) ?? '',
    profileText: lines.join('\n').slice(0, MATERIAL_MAX_PROFILE_CHARS),
    skillNames,
    organisationNames,
    jobTitles,
    technologies: [...new Set(technologies)],
    numbers: collectNumbers(...numericSources),
    confirmed: Boolean(profile?.careerProfileConfirmedAt),
    careerProfileVersion: profile?.careerProfileVersion ?? 0,
  };
}

// ─── Job ────────────────────────────────────────────────────────────────────

/**
 * Load one job the caller OWNS.
 *
 * Returns null for a job belonging to someone else, exactly as it does for one
 * that does not exist. The response must never confirm that another user's lead
 * exists, so there is no separate "forbidden" path here.
 */
export async function buildJobFacts(
  userId: string,
  jobId: string | null | undefined,
): Promise<JobFacts | null> {
  if (!jobId) return null;

  const job = await prisma.jobLead.findFirst({
    where: { id: jobId, userId, deletedAt: null },
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      remoteType: true,
      status: true,
      dateApplied: true,
      nextFollowUp: true,
      jobDescription: true,
      updatedAt: true,
      contacts: true,
      interviews: true,
    },
  });

  if (!job) return null;

  const description = tidyMultiline(job.jobDescription, MATERIAL_MAX_JOB_CHARS);

  // `contacts` and `interviews` are JSON columns with no schema. Parsing is
  // defensive on purpose: a malformed entry must not break generation, and
  // nothing here may invent a contact that is not stored.
  const rawContacts = Array.isArray(job.contacts) ? job.contacts : [];
  const contacts = rawContacts
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return null;
      const record = entry as Record<string, unknown>;
      const name = tidy(record.name as string | null | undefined, 120);
      if (!name) return null;
      return {
        name,
        title: tidy(record.title as string | null | undefined, 120) ?? '',
        company: tidy(record.company as string | null | undefined, 120) ?? '',
        relationshipType: tidy(
          record.relationshipType as string | null | undefined,
          40,
        ) ?? '',
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .slice(0, 6);

  const rawInterviews = Array.isArray(job.interviews) ? job.interviews : [];
  const interviews = rawInterviews
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return null;
      const record = entry as Record<string, unknown>;
      const scheduledAt = record.scheduledAt;
      if (typeof scheduledAt !== 'string' || !scheduledAt) return null;
      const parsed = new Date(scheduledAt);
      if (Number.isNaN(parsed.getTime())) return null;
      return {
        scheduledAt: parsed.toISOString(),
        stage: tidy(record.stage as string | null | undefined, 60) ?? '',
        type:
          tidy(record.interviewType as string | null | undefined, 60) ??
          tidy(record.stage as string | null | undefined, 60) ??
          '',
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
    .slice(0, 4);

  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location ?? '',
    remoteType: job.remoteType ?? '',
    status: job.status,
    dateApplied: job.dateApplied,
    nextFollowUp: job.nextFollowUp,
    description,
    hasDescription: description.length >= 40,
    truncated: (job.jobDescription?.length ?? 0) > MATERIAL_MAX_JOB_CHARS,
    contacts,
    interviews,
    updatedAt: job.updatedAt,
  };
}

/**
 * What we can honestly claim about this application.
 *
 * Derived from stored fields only. `hasApplied` reads the pipeline status and
 * the applied date; `hasInterview` requires an actual interview row. Neither is
 * inferred from the mere existence of a contact record, because having a
 * recruiter in your contacts says nothing about whether you applied.
 */
export function resolveApplicationContext(job: JobFacts | null): ApplicationContext {
  if (!job) {
    return { stage: 'NONE', hasApplied: false, hasInterview: false, latestInterview: null };
  }

  const hasApplied =
    APPLIED_STATUSES.includes(job.status) || job.dateApplied !== null || job.nextFollowUp !== null;
  const latestInterview = job.interviews[0] ?? null;

  let stage: ApplicationContext['stage'] = 'NONE';
  if (latestInterview) stage = 'INTERVIEW_RECORDED';
  else if (hasApplied) stage = 'SUBMITTED';
  else if (job.status === 'INTERVIEWING') stage = 'INTERVIEW_SCHEDULED';

  return { stage, hasApplied, hasInterview: Boolean(latestInterview), latestInterview };
}

// ─── Resume ─────────────────────────────────────────────────────────────────

/**
 * Load a saved resume the caller OWNS.
 *
 * A missing or foreign id raises the same not-found error, so a client cannot
 * borrow another user's tailored version as grounding context.
 */
export async function buildResumeFacts(
  userId: string,
  resumeId: string | null | undefined,
  profileVersion: number,
): Promise<ResumeFacts | null> {
  if (!resumeId) return null;

  const resume = await getResume({ userId, resumeId });
  const text = flattenResumeContent(resume.content);
  const boundedText = text.slice(0, MATERIAL_MAX_RESUME_CHARS);

  return {
    id: resume.id,
    name: resume.name,
    text: boundedText,
    truncated: text.length > MATERIAL_MAX_RESUME_CHARS,
    stale:
      resume.sourceProfileVersion !== null && resume.sourceProfileVersion < profileVersion,
    sourceProfileVersion: resume.sourceProfileVersion,
    evidence: resumeEvidence(resume.content, boundedText),
  };
}

function resumeEvidence(content: ResumeContent, text: string): ResumeFacts['evidence'] {
  const visibleValues = (values: Array<string | null | undefined>) =>
    [...new Set(values.filter((value): value is string => Boolean(value)))].filter((value) =>
      text.toLocaleLowerCase().includes(value.toLocaleLowerCase()),
    );

  return {
    numbers: collectNumbers(text),
    organisationNames: visibleValues([
      ...content.experiences.map((entry) => entry.company),
      ...content.education.map((entry) => entry.institution),
      ...content.credentials.flatMap((entry) => [entry.name, entry.issuer]),
      ...content.projects.map((entry) => entry.name),
    ]),
    jobTitles: visibleValues([
      ...content.experiences.map((entry) => entry.jobTitle),
      ...content.projects.map((entry) => entry.role),
    ]),
    technologies: visibleValues([
      ...content.experiences.flatMap((entry) => entry.technologies),
      ...content.projects.flatMap((entry) => entry.technologies),
    ]),
    skillNames: visibleValues(content.skills.map((entry) => entry.name)),
  };
}

/**
 * Flatten a structured resume to text.
 *
 * Defensive throughout: the shape is validated when it is written, but this
 * runs against a stored JSON document and an unexpected field must produce
 * less context, not a crash mid-generation.
 */
function flattenResumeContent(content: unknown): string {
  if (typeof content !== 'object' || content === null) return '';
  const doc = content as Record<string, unknown>;

  const lines: string[] = [];
  const basics = doc.basics;
  if (typeof basics === 'object' && basics !== null) {
    const record = basics as Record<string, unknown>;
    if (typeof record.headline === 'string') {
      pushLine(lines, 'Headline', tidy(record.headline, 200));
    }
  }
  if (typeof doc.summary === 'string') {
    pushLine(lines, 'Summary', tidy(doc.summary, 600));
  }

  const appendSection = (
    label: string,
    rows: unknown,
    fields: Array<[string, (value: unknown, record: Record<string, unknown>) => string | null]>,
  ) => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    lines.push(`--- ${label} ---`);
    for (const row of rows.slice(0, 10)) {
      if (typeof row !== 'object' || row === null) continue;
      const record = row as Record<string, unknown>;
      const parts: string[] = [];
      for (const [key, format] of fields) {
        const value = format(record[key], record);
        if (value) parts.push(`${key}: ${value}`);
      }
      if (parts.length) lines.push(`- ${parts.join(' | ')}`);
    }
  };

  const asText = (value: unknown, max = 400): string | null => {
    if (typeof value === 'string') return tidy(value, max);
    if (Array.isArray(value)) {
      const joined = value
        .map((item) => (typeof item === 'string' ? tidy(item, max) : null))
        .filter((item): item is string => Boolean(item))
        .join('; ');
      return joined || null;
    }
    return null;
  };

  appendSection('Experience', doc.experiences, [
    ['role', (v) => asText(v, 120)],
    ['company', (v) => asText(v, 120)],
    ['location', (v) => asText(v, 120)],
    [
      'dates',
      (_, record) => {
        const start = asText(record.startDate, 40);
        const end = record.isCurrent === true ? 'Present' : asText(record.endDate, 40);
        return [start, end].filter(Boolean).join(' – ') || null;
      },
    ],
    ['responsibilities', (v) => asText(v, 600)],
    ['achievements', (v) => asText(v, 600)],
    ['technologies', (v) => asText(v, 300)],
  ]);
  appendSection('Projects', doc.projects, [
    ['name', (v) => asText(v, 120)],
    ['role', (v) => asText(v, 120)],
    ['description', (v) => asText(v, 400)],
    ['technologies', (v) => asText(v, 300)],
    ['results', (v) => asText(v, 400)],
  ]);
  appendSection('Education', doc.education, [
    ['qualification', (v) => asText(v, 120)],
    ['institution', (v) => asText(v, 120)],
    ['field of study', (v) => asText(v, 120)],
    ['details', (v) => asText(v, 300)],
  ]);
  appendSection('Skills', doc.skills, [
    ['name', (v) => asText(v, 120)],
    ['category', (v) => asText(v, 120)],
  ]);
  appendSection('Credentials', doc.credentials, [
    ['name', (v) => asText(v, 120)],
    ['issuer', (v) => asText(v, 120)],
    ['proficiency', (v) => asText(v, 120)],
    ['details', (v) => asText(v, 300)],
  ]);

  return lines.join('\n');
}

// ─── Earlier materials ──────────────────────────────────────────────────────

/**
 * Load the newest material of each OTHER type for this exact application.
 *
 * Bounded in three directions: at most five materials, at most 900 characters
 * each, and at most 4,200 characters in total. A job with twenty revisions
 * therefore contributes the same prompt budget as a job with five.
 *
 * One per type, newest first: sending four successive drafts of the same cover
 * letter would teach the model to copy its own older wording, not to continue
 * the application.
 */
async function buildPriorMaterialFacts(
  userId: string,
  jobId: string | null,
  currentType: MaterialType,
): Promise<PriorMaterialFacts[]> {
  if (!jobId) return [];

  const rows = await prisma.applicationMaterial.findMany({
    where: {
      userId,
      jobId,
      type: { not: currentType },
      generationStatus: 'COMPLETED',
      status: { not: 'ARCHIVED' },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 24,
    select: {
      id: true,
      type: true,
      title: true,
      subject: true,
      status: true,
      content: true,
      generationMeta: true,
      updatedAt: true,
    },
  });

  const seenTypes = new Set<string>();
  const materials: PriorMaterialFacts[] = [];
  let usedChars = 0;

  for (const row of rows) {
    if (seenTypes.has(row.type)) continue;

    const stored = getStoredMaterialContent({
      content: row.content,
      generationMeta: row.generationMeta,
      status: row.status,
    });
    const content = tidyMultiline(stored, MATERIAL_MAX_PRIOR_MATERIAL_CHARS);
    if (!content) continue;

    const remaining = MATERIAL_MAX_PRIOR_CONTEXT_CHARS - usedChars;
    if (remaining <= 80) break;

    const bounded = content.slice(0, Math.min(content.length, remaining));
    seenTypes.add(row.type);
    usedChars += bounded.length;
    materials.push({
      id: row.id,
      type: row.type as MaterialType,
      label: MATERIAL_TYPE_META[row.type as MaterialType]?.label ?? 'Application material',
      title: row.title,
      subject: row.subject,
      status: row.status,
      updatedAt: row.updatedAt,
      content: bounded,
    });

    if (materials.length >= MATERIAL_MAX_PRIOR_MATERIALS) break;
  }

  return materials;
}

// ─── Assembly ───────────────────────────────────────────────────────────────

export type BuildContextParams = {
  userId: string;
  type: MaterialType;
  jobId: string | null;
  resumeId: string | null;
  profileVersion: number;
};

/**
 * Build the complete context for one generation.
 *
 * The job and the candidate are independent reads, so they run together; the
 * resume is only fetched when explicitly selected, because sending a whole
 * document the user did not ask us to use would be a larger exposure than this
 * task needs.
 */
export async function buildMaterialContext(
  params: BuildContextParams,
): Promise<MaterialContext> {
  const [candidate, job] = await Promise.all([
    buildCandidateFacts(params.userId),
    buildJobFacts(params.userId, params.jobId),
  ]);

  const resume = await buildResumeFacts(
    params.userId,
    params.resumeId,
    candidate.careerProfileVersion,
  );
  const candidateWithResume = resume
    ? {
        ...candidate,
        numbers: [...new Set([...candidate.numbers, ...resume.evidence.numbers])],
        organisationNames: [
          ...new Set([...candidate.organisationNames, ...resume.evidence.organisationNames]),
        ],
        jobTitles: [...new Set([...candidate.jobTitles, ...resume.evidence.jobTitles])],
        technologies: [...new Set([...candidate.technologies, ...resume.evidence.technologies])],
        skillNames: [...new Set([...candidate.skillNames, ...resume.evidence.skillNames])],
      }
    : candidate;

  // A valid completed analysis is useful context for what the role asks for.
  // It is labelled as the model's own reading throughout, and it can never be
  // quoted as evidence.
  let intelligence: MaterialContext['intelligence'] = null;
  if (job) {
    const analysis = await prisma.jobIntelligenceAnalysis.findFirst({
      where: { userId: params.userId, jobId: job.id, status: 'COMPLETED', schemaVersion: 1 },
      orderBy: { completedAt: 'desc' },
      select: { data: true },
    });
    const data = analysis?.data as { summary?: unknown; overallCategory?: unknown } | null | undefined;
    if (data && typeof data.summary === 'string') {
      intelligence = {
        summary: tidy(data.summary, 400) ?? '',
        category: typeof data.overallCategory === 'string' ? data.overallCategory : 'UNKNOWN',
      };
    }
  }

  const application = resolveApplicationContext(job);
  const priorMaterials = await buildPriorMaterialFacts(
    params.userId,
    job?.id ?? null,
    params.type,
  );

  // ── What is genuinely missing ────────────────────────────────────────────
  const missingInputs: string[] = [];
  if (candidate.skillNames.length === 0 && candidate.jobTitles.length === 0) {
    missingInputs.push('any confirmed work history or skills in your career profile');
  }
  if (!candidate.confirmed) missingInputs.push('a career profile you have reviewed and confirmed');
  if (!job) {
    missingInputs.push('a target job with its description');
  } else {
    if (!job.hasDescription) missingInputs.push('a job description for this role');
    if (!job.company) missingInputs.push('the company name for this role');
  }
  if (job && !application.hasApplied && params.type !== 'COVER_LETTER' && params.type !== 'RECRUITER_OUTREACH' && params.type !== 'LINKEDIN_CONNECTION') {
    missingInputs.push('a record that you applied to this role');
  }
  if (job && !application.hasInterview && params.type === 'INTERVIEW_THANK_YOU') {
    missingInputs.push('a recorded interview or your own notes about it');
  }
  if (params.type === 'RECRUITER_OUTREACH' || params.type === 'LINKEDIN_CONNECTION') {
    if (!job || job.contacts.length === 0) {
      missingInputs.push('a saved contact for this role');
    }
  }

  let completeness: MaterialContext['completeness'] = 'COMPLETE';
  if (missingInputs.length >= 3) completeness = 'MINIMAL';
  else if (missingInputs.length >= 1) completeness = 'PARTIAL';

  return {
    type: params.type,
    candidate: candidateWithResume,
    job,
    application,
    resume,
    intelligence,
    priorMaterials,
    missingInputs,
    completeness,
  };
}

/**
 * Candidate facts are read once per request and passed straight through, so
 * there is exactly one profile query per generation and no module-level state
 * that two concurrent requests could share.
 */
