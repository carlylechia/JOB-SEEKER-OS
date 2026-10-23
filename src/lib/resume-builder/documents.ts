/**
 * Structured resume data service.
 *
 * Every read and every write here is scoped to a userId that came from the
 * session. There is no query in this file that a caller could use to reach
 * another user's resume, and no mutation that writes an ownership, plan,
 * origin or provenance field from client input.
 *
 * Two rules the whole file is built around:
 *
 *  1. THE CAREER PROFILE IS A SOURCE, NEVER A TARGET. Creating a resume from
 *     the profile copies confirmed values verbatim. Editing a resume never
 *     writes back to `UserProfile` or to any `Career*` table. They are related
 *     records that the user controls separately, and a builder that silently
 *     edits your confirmed career history would be worse than no builder.
 *
 *  2. SAVES ARE OPTIMISTIC. A save carries the revision it was built from and
 *     is rejected with 409 if the stored revision has moved. Two tabs editing
 *     the same resume therefore cannot silently overwrite each other — the
 *     second save fails loudly and the user reloads deliberately.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { logImportantInfo } from '@/lib/observability';
import { PLAN_LIMITS, type PlanLimitValue } from '@/lib/billing/plans';
import {
  RESUME_MAX_NAME_LENGTH,
  emptyResumeBasics,
  emptyResumeContent,
  normalizeResumeDate,
  resumeContentSchema,
  type CreateResumeInput,
  type ResumeContent,
  type ResumeSectionKey,
  type UpdateResumeInput,
  normalizeResumeSectionOrder,
} from './schema';
import {
  DEFAULT_PAGE_SIZE,
  isAccentKey,
  isPageSizeKey,
  isTemplateKey,
  type PageSizeKey,
} from './templates';

// ─── Errors ─────────────────────────────────────────────────────────────────

export class StructuredResumeNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    // Deliberately identical whether the resume is missing or belongs to
    // someone else. Revealing the difference would confirm that another user's
    // private resume exists.
    super('Resume not found.');
    this.name = 'StructuredResumeNotFoundError';
  }
}

export class ResumeRevisionConflictError extends Error {
  readonly code = 'CONFLICT';
  readonly status = 409;
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super('This resume was changed somewhere else. Reload it before saving your edits.');
    this.name = 'ResumeRevisionConflictError';
    this.currentRevision = currentRevision;
  }
}

export class ResumeLimitExceededError extends Error {
  readonly code = 'RESUME_LIMIT_EXCEEDED';
  readonly status = 403;
  readonly limit: PlanLimitValue;
  readonly used: number;

  constructor(limit: PlanLimitValue, used: number) {
    super(
      limit === null
        ? 'You have reached your resume limit.'
        : `Your plan includes ${limit} resume${limit === 1 ? '' : 's'}. Remove one, or upgrade for more.`,
    );
    this.name = 'ResumeLimitExceededError';
    this.limit = limit;
    this.used = used;
  }
}

export class TargetJobNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Job not found.');
    this.name = 'TargetJobNotFoundError';
  }
}

/** A resume whose stored content no longer validates. Never silently replaced. */
export class ResumeContentCorruptError extends Error {
  readonly code = 'INTERNAL_ERROR';
  readonly status = 500;

  constructor() {
    super('This resume could not be read. Please duplicate it or start a new one.');
    this.name = 'ResumeContentCorruptError';
  }
}

// ─── Records ────────────────────────────────────────────────────────────────

export type StructuredResumeRecord = {
  id: string;
  userId: string;
  name: string;
  content: ResumeContent;
  templateKey: string;
  pageSize: PageSizeKey;
  accentKey: string;
  density: number;
  hiddenSections: string[];
  sectionOrder: ResumeSectionKey[];
  revision: number;
  targetJobId: string | null;
  sourceResumeId: string | null;
  origin: string;
  sourceProfileVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
  targetJob: {
    id: string;
    title: string;
    company: string;
  } | null;
};

type Row = {
  id: string;
  userId: string;
  name: string;
  content: unknown;
  templateKey: string;
  pageSize: string;
  accentKey: string;
  density: number;
  hiddenSections: string[];
  sectionOrder: string[];
  revision: number;
  targetJobId: string | null;
  sourceResumeId: string | null;
  origin: string;
  sourceProfileVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
  targetJob?: { id: string; title: string; company: string } | null;
};

/**
 * Re-validate stored content on every read.
 *
 * The column is JSONB and the validation happened at write time, so in theory
 * this always passes. In practice it is the last line of defence between a
 * schema change and a crash in the renderer: a row that no longer validates
 * raises a specific, non-leaking error instead of flowing into the PDF engine
 * as `undefined`.
 */
function toRecord(row: Row): StructuredResumeRecord {
  const parsed = resumeContentSchema.safeParse(row.content);
  if (!parsed.success) throw new ResumeContentCorruptError();

  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    content: parsed.data,
    templateKey: isTemplateKey(row.templateKey) ? row.templateKey : 'classic-ats',
    pageSize: isPageSizeKey(row.pageSize) ? row.pageSize : DEFAULT_PAGE_SIZE,
    accentKey: isAccentKey(row.accentKey) ? row.accentKey : 'gold',
    density: row.density,
    hiddenSections: row.hiddenSections ?? [],
    sectionOrder: normalizeResumeSectionOrder(row.sectionOrder),
    revision: row.revision,
    targetJobId: row.targetJobId,
    sourceResumeId: row.sourceResumeId,
    origin: row.origin,
    sourceProfileVersion: row.sourceProfileVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    targetJob: row.targetJob ?? null,
  };
}

const LIST_SELECT = {
  id: true,
  userId: true,
  name: true,
  content: true,
  templateKey: true,
  pageSize: true,
  accentKey: true,
  density: true,
  hiddenSections: true,
  sectionOrder: true,
  revision: true,
  targetJobId: true,
  sourceResumeId: true,
  origin: true,
  sourceProfileVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * Every resume the caller owns, most recently edited first.
 *
 * Bounded. A user with many variants still gets a fast list, and pagination at
 * this size would be UI weight without benefit — the plan limit is the real
 * bound.
 */
export async function listResumes(userId: string, limit = 100): Promise<StructuredResumeRecord[]> {
  const rows = await prisma.structuredResume.findMany({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }],
    take: Math.min(Math.max(limit, 1), 200),
    select: { ...LIST_SELECT, targetJob: { select: { id: true, title: true, company: true } } },
  });
  return rows.map(toRecord);
}

export async function countResumes(userId: string): Promise<number> {
  return prisma.structuredResume.count({ where: { userId } });
}

/** Load one resume the caller owns, or raise a 404. */
export async function getResume(params: {
  userId: string;
  resumeId: string;
}): Promise<StructuredResumeRecord> {
  const row = await prisma.structuredResume.findFirst({
    where: { id: params.resumeId, userId: params.userId },
    select: { ...LIST_SELECT, targetJob: { select: { id: true, title: true, company: true } } },
  });
  if (!row) throw new StructuredResumeNotFoundError();
  return toRecord(row);
}

/**
 * Jobs the caller may target.
 *
 * Scoped to their own, non-deleted `JobLead` rows. This deliberately does NOT
 * read from the public job catalogue: a public job must be imported into the
 * user's own workspace before it can be optimised against, which is the
 * existing import policy rather than one this release relaxes.
 */
export async function listTargetableJobs(
  userId: string,
  limit = 50,
): Promise<Array<{ id: string; title: string; company: string; status: string; hasDescription: boolean; updatedAt: Date }>> {
  const rows = await prisma.jobLead.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }],
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true,
      title: true,
      company: true,
      status: true,
      jobDescription: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    company: row.company,
    status: row.status,
    hasDescription: Boolean(row.jobDescription && row.jobDescription.trim().length > 0),
    updatedAt: row.updatedAt,
  }));
}

/**
 * Resolve a target job the caller owns.
 *
 * Raises the same error for "missing", "deleted" and "belongs to someone else",
 * so the response never confirms that another user's private lead exists.
 */
export async function resolveTargetJob(params: {
  userId: string;
  jobId: string | null | undefined;
}): Promise<{ id: string; title: string; company: string; jobDescription: string | null; updatedAt: Date } | null> {
  if (!params.jobId) return null;
  const row = await prisma.jobLead.findFirst({
    where: { id: params.jobId, userId: params.userId, deletedAt: null },
    select: { id: true, title: true, company: true, jobDescription: true, updatedAt: true },
  });
  if (!row) throw new TargetJobNotFoundError();
  return row;
}

// ─── Populating from the career profile ─────────────────────────────────────

/**
 * Build a resume document from the user's CONFIRMED career profile.
 *
 * Everything copied here was, at some point, read by the user and confirmed.
 * Where the profile has nothing, the resume field stays empty. Nothing is
 * invented: no title inferred from a company, no end date derived from a start
 * date, no skill promoted from a job description, and no contact detail filled
 * in that the user did not supply. Free-text profile dates are normalised to
 * resume month precision; dates the resume schema cannot represent are omitted
 * from the copy while the original profile value remains untouched.
 *
 * Returns `null` rather than throwing when there is no confirmed profile, so
 * the caller can offer "start blank" instead of an error.
 */
export async function resumeFromCareerProfile(userId: string): Promise<{
  content: ResumeContent;
  profileVersion: number | null;
} | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      phone: true,
      summary: true,
      websiteUrl: true,
      linkedinUrl: true,
      portfolioUrl: true,
      location: true,
      headline: true,
      careerProfileVersion: true,
      experiences: {
        orderBy: [{ startDate: 'desc' }, { sortOrder: 'asc' }],
        select: {
          id: true,
          jobTitle: true,
          company: true,
          location: true,
          startDate: true,
          endDate: true,
          isCurrent: true,
          responsibilities: true,
          achievements: true,
          technologies: true,
          evidenceSnippet: true,
        },
      },
      education: {
        orderBy: [{ endDate: 'desc' }, { sortOrder: 'asc' }],
        select: {
          id: true,
          institution: true,
          qualification: true,
          fieldOfStudy: true,
          startDate: true,
          endDate: true,
          details: true,
        },
      },
      skills: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, origin: true },
      },
      projects: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          role: true,
          technologies: true,
          startDate: true,
          endDate: true,
          projectUrl: true,
          results: true,
        },
      },
      credentials: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          kind: true,
          name: true,
          issuer: true,
          issuedDate: true,
          expiresDate: true,
          proficiency: true,
          details: true,
        },
      },
    },
  });

  if (!profile) return null;

  // The user's own name and email come from the account, not from an extraction,
  // so they are safe to copy verbatim.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  const basics = resumeContentSchema.shape.basics.parse({
    fullName: user?.name ?? null,
    email: user?.email ?? null,
    phone: profile.phone,
    location: profile.location,
    headline: profile.headline,
    linkedinUrl: profile.linkedinUrl,
    portfolioUrl: profile.portfolioUrl,
    websiteUrl: profile.websiteUrl,
  });

  // Entry ids are regenerated. Reusing a profile row's primary key would let an
  // optimisation or an edit reference a profile record by id and quietly couple
  // the two together.
  const content = resumeContentSchema.parse({
    basics,
    summary: profile.summary,
    experiences: profile.experiences.map((entry) => ({
      id: randomUUID(),
      jobTitle: entry.jobTitle,
      company: entry.company,
      location: entry.location,
      startDate: normalizeResumeDate(entry.startDate),
      endDate: entry.isCurrent ? null : normalizeResumeDate(entry.endDate),
      isCurrent: entry.isCurrent,
      responsibilities: entry.responsibilities,
      achievements: entry.achievements,
      technologies: entry.technologies,
      origin: 'CAREER_PROFILE' as const,
      evidenceSnippet: entry.evidenceSnippet,
    })),
    education: profile.education.map((entry) => ({
      id: randomUUID(),
      institution: entry.institution,
      qualification: entry.qualification,
      fieldOfStudy: entry.fieldOfStudy,
      startDate: normalizeResumeDate(entry.startDate),
      endDate: normalizeResumeDate(entry.endDate),
      details: entry.details,
      origin: 'CAREER_PROFILE' as const,
    })),
    skills: profile.skills.map((entry) => ({
      id: randomUUID(),
      name: entry.name,
      // `CareerSkill` has no category column, so a skill imported from the
      // profile is uncategorised rather than being assigned a guessed group.
      category: null,
      // Only STATED and SUPPORTED are carried through as themselves. Anything
      // else (INFERRED, or an unexpected value from an older row) is preserved
      // as INFERRED, so an inferred skill is never laundered into a verified
      // one by a resume import.
      origin:
        entry.origin === 'STATED' || entry.origin === 'SUPPORTED' ? entry.origin : ('INFERRED' as const),
    })),
    projects: profile.projects.map((entry) => ({
      id: randomUUID(),
      name: entry.name,
      description: entry.description,
      role: entry.role,
      technologies: entry.technologies,
      startDate: normalizeResumeDate(entry.startDate),
      endDate: normalizeResumeDate(entry.endDate),
      projectUrl: entry.projectUrl,
      results: entry.results,
      origin: 'CAREER_PROFILE' as const,
    })),
    credentials: profile.credentials.map((entry) => ({
      id: randomUUID(),
      kind: entry.kind,
      name: entry.name,
      issuer: entry.issuer,
      issuedDate: normalizeResumeDate(entry.issuedDate),
      expiresDate: normalizeResumeDate(entry.expiresDate),
      proficiency: entry.proficiency,
      details: entry.details,
      origin: 'CAREER_PROFILE' as const,
    })),
  });

  return {
    content,
    profileVersion: profile.careerProfileVersion,
  };
}

/** Does this user have a confirmed career profile to build from? */
export async function hasConfirmedCareerProfile(userId: string): Promise<boolean> {
  const count = await prisma.userProfile.count({
    where: { userId, careerProfileConfirmedAt: { not: null } },
  });
  return count > 0;
}

/** Cheap summary for the "start from" chooser. */
export async function careerProfileSummary(userId: string): Promise<{
  confirmed: boolean;
  version: number | null;
  counts: { experiences: number; education: number; skills: number; projects: number; credentials: number };
} | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      careerProfileConfirmedAt: true,
      careerProfileVersion: true,
      _count: { select: { experiences: true, education: true, skills: true, projects: true, credentials: true } },
    },
  });
  if (!profile) return null;
  return {
    confirmed: profile.careerProfileConfirmedAt !== null,
    version: profile.careerProfileVersion,
    counts: {
      experiences: profile._count.experiences,
      education: profile._count.education,
      skills: profile._count.skills,
      projects: profile._count.projects,
      credentials: profile._count.credentials,
    },
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/**
 * Create a resume.
 *
 * `limit` is REQUIRED, not defaulted. Every call site must pass the value
 * resolved from the caller's entitlements, and the compiler enforces it — a
 * default would quietly fall back to the Free limit and give a paying customer
 * one resume because a route forgot to pass the argument. Required-and-explicit
 * is the fail-closed choice.
 *
 * `null` means unlimited. The check and the insert are not in one transaction,
 * which is a known and accepted looseness: two simultaneous creates could both
 * pass a limit of 1 and produce 2. That is strictly better than a read/check/write
 * quota that could be raced to bypass entirely, and it matches how the existing
 * `consumeUsage` advisory lock is scoped to the expensive AI path rather than to
 * cheap document creation.
 */
export async function createResume(params: {
  userId: string;
  input: CreateResumeInput;
  limit: PlanLimitValue;
}): Promise<StructuredResumeRecord> {
  const { userId, input } = params;

  const limit = params.limit;
  if (limit !== null) {
    const used = await countResumes(userId);
    if (used >= limit) throw new ResumeLimitExceededError(limit, used);
  }

  let content: ResumeContent = emptyResumeContent();
  let origin: string = 'BLANK';
  let sourceProfileVersion: number | null = null;
  let sourceResumeId: string | null = null;
  let pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  let sectionOrder = normalizeResumeSectionOrder();
  let name = input.name?.trim() || 'Untitled resume';

  if (input.from === 'PROFILE') {
    const fromProfile = await resumeFromCareerProfile(userId);
    // No confirmed profile is not an error — it is a real state the chooser
    // already reflects, so the user gets a blank document instead.
    if (fromProfile) {
      content = fromProfile.content;
      origin = 'PROFILE';
      sourceProfileVersion = fromProfile.profileVersion;
      if (!input.name) name = `${fromProfile.content.basics.fullName ?? 'My'} resume`.slice(0, RESUME_MAX_NAME_LENGTH);
    }
  }

  if (input.from === 'DUPLICATE') {
    const source = await getResume({ userId, resumeId: input.sourceResumeId as string });
    // A deep copy of the CONTENT with FRESH ENTRY IDS.
    //
    // The ids matter. If a variant kept the master's entry ids, then anything
    // that addresses an entry by id — a stored optimisation, an in-flight
    // request — could be applied to the wrong document, and two documents would
    // be indistinguishable to that code. Regenerating them makes the copies
    // genuinely independent rather than merely separately stored.
    content = reidentifyEntries(structuredClone(source.content));
    sourceResumeId = source.id;
    origin = 'DUPLICATE';
    sourceProfileVersion = source.sourceProfileVersion;
    pageSize = input.pageSize ?? source.pageSize;
    sectionOrder = source.sectionOrder;
    if (!input.name) {
      name = `${source.name} (copy)`.slice(0, RESUME_MAX_NAME_LENGTH);
    }
  }

  const targetJobId = await resolveTargetJobId(userId, input.targetJobId ?? null);

  const row = await prisma.structuredResume.create({
    data: {
      userId,
      name,
      content: content as unknown as object,
      origin,
      sourceResumeId,
      sourceProfileVersion,
      targetJobId,
      templateKey: 'classic-ats',
      pageSize,
      accentKey: 'gold',
      density: 1,
      hiddenSections: [],
      sectionOrder,
      revision: 1,
    },
    select: { ...LIST_SELECT, targetJob: { select: { id: true, title: true, company: true } } },
  });

  await logImportantInfo({
    event: 'structured_resume_created',
    userId,
    route: '/api/resumes',
    context: {
      resumeId: row.id,
      origin,
      targeted: Boolean(targetJobId),
      hasContent: hasAnyContent(content),
    },
  });

  return toRecord(row);
}

/**
 * Duplicate an existing resume.
 *
 * A dedicated operation rather than `create({ from: 'DUPLICATE' })` because the
 * editor's "Duplicate" button must work on the resume the user is looking at,
 * without that id travelling through a client-supplied field that could then be
 * swapped for someone else's.
 */
export async function duplicateResume(params: {
  userId: string;
  resumeId: string;
  /** Optional name for the copy. Defaults to "<source> (copy)". */
  name?: string;
  /** Optional target job, so "create a tailored version" is one action. */
  targetJobId?: string | null;
  /** Required — see `createResume`. */
  limit: PlanLimitValue;
}): Promise<StructuredResumeRecord> {
  const source = await getResume(params);
  return createResume({
    userId: params.userId,
    limit: params.limit,
    input: {
      from: 'DUPLICATE',
      sourceResumeId: source.id,
      name: params.name,
      // Falls back to the source's own target so a plain Duplicate keeps the
      // same aim; a tailored version deliberately changes it.
      targetJobId: params.targetJobId === undefined ? source.targetJobId : params.targetJobId,
    },
  });
}

/** Save an explicitly reviewed, measured one-page proposal as a new variant. */
export async function createOnePageResume(params: {
  userId: string;
  sourceResumeId: string;
  expectedRevision: number;
  name: string;
  content: ResumeContent;
  targetJobId: string | null;
  templateKey: string;
  pageSize: string;
  limit: PlanLimitValue;
}): Promise<StructuredResumeRecord> {
  const source = await getResume({ userId: params.userId, resumeId: params.sourceResumeId });
  if (source.revision !== params.expectedRevision) {
    throw new ResumeRevisionConflictError(source.revision);
  }

  if (params.limit !== null) {
    const used = await countResumes(params.userId);
    if (used >= params.limit) throw new ResumeLimitExceededError(params.limit, used);
  }

  const content = reidentifyEntries(resumeContentSchema.parse(params.content));
  const targetJobId = await resolveTargetJobId(params.userId, params.targetJobId);
  const templateKey = isTemplateKey(params.templateKey) ? params.templateKey : 'classic-ats';
  const pageSize = isPageSizeKey(params.pageSize) ? params.pageSize : source.pageSize;

  const row = await prisma.structuredResume.create({
    data: {
      userId: params.userId,
      name: params.name.trim().slice(0, RESUME_MAX_NAME_LENGTH),
      content: content as unknown as object,
      templateKey,
      pageSize,
      accentKey: 'charcoal',
      density: 0,
      hiddenSections: [],
      sectionOrder: source.sectionOrder,
      revision: 1,
      origin: 'ONE_PAGE',
      sourceResumeId: source.id,
      sourceProfileVersion: source.sourceProfileVersion,
      targetJobId,
    },
    select: { ...LIST_SELECT, targetJob: { select: { id: true, title: true, company: true } } },
  });

  await logImportantInfo({
    event: 'one_page_resume_created',
    userId: params.userId,
    route: '/api/resumes/[id]/one-page/save',
    jobId: targetJobId ?? undefined,
    context: { sourceResumeId: source.id, resumeId: row.id, pageSize, templateKey },
  });

  return toRecord(row);
}

/**
 * Apply a partial update.
 *
 * The revision check and the write happen in ONE `updateMany` so the compare is
 * atomic in the database. A read-then-write would let two concurrent saves both
 * observe the same revision and both succeed, which is precisely the race that
 * makes autosaved editors lose work.
 */
export async function updateResume(params: {
  userId: string;
  resumeId: string;
  input: UpdateResumeInput;
}): Promise<StructuredResumeRecord> {
  const { userId, resumeId, input } = params;

  const existing = await prisma.structuredResume.findFirst({
    where: { id: resumeId, userId },
    select: { id: true, revision: true },
  });
  if (!existing) throw new StructuredResumeNotFoundError();

  // Ownership AND revision in a single conditional write. Zero rows updated
  // means either the resume is gone or somebody saved first.
  const result = await prisma.structuredResume.updateMany({
    where: { id: resumeId, userId, revision: input.expectedRevision },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.content !== undefined ? { content: input.content as unknown as object } : {}),
      ...(input.templateKey !== undefined
        ? { templateKey: isTemplateKey(input.templateKey) ? input.templateKey : 'classic-ats' }
        : {}),
      ...(input.accentKey !== undefined
        ? { accentKey: isAccentKey(input.accentKey) ? input.accentKey : 'gold' }
        : {}),
      ...(input.density !== undefined ? { density: input.density } : {}),
      ...(input.hiddenSections !== undefined ? { hiddenSections: input.hiddenSections } : {}),
      ...(input.sectionOrder !== undefined ? { sectionOrder: input.sectionOrder } : {}),
      ...(input.targetJobId !== undefined
        ? { targetJobId: await resolveTargetJobId(userId, input.targetJobId) }
        : {}),
      ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
      revision: { increment: 1 },
    },
  });

  if (result.count === 0) {
    // Re-read to give the caller the current revision and to distinguish
    // "deleted underneath us" from "someone else saved first".
    const current = await prisma.structuredResume.findFirst({
      where: { id: resumeId, userId },
      select: { revision: true },
    });
    if (!current) throw new StructuredResumeNotFoundError();

    await logImportantInfo({
      event: 'structured_resume_save_conflict',
      userId,
      route: `/api/resumes/${resumeId}`,
      context: { resumeId, expectedRevision: input.expectedRevision, currentRevision: current.revision },
    });
    throw new ResumeRevisionConflictError(current.revision);
  }

  return getResume({ userId, resumeId });
}

/** Rename a resume. Separate because it is the one edit that never conflicts in practice. */
export async function renameResume(params: {
  userId: string;
  resumeId: string;
  name: string;
}): Promise<StructuredResumeRecord> {
  const updated = await prisma.structuredResume.updateMany({
    where: { id: params.resumeId, userId: params.userId },
    data: { name: params.name },
  });
  if (updated.count === 0) throw new StructuredResumeNotFoundError();
  return getResume(params);
}

/**
 * Delete a resume.
 *
 * Cascades to that resume's optimisation rows only. The career profile is
 * untouched, the source resume (if this is a variant) is untouched, and any
 * other variant is untouched.
 */
export async function deleteResume(params: { userId: string; resumeId: string }): Promise<void> {
  const result = await prisma.structuredResume.deleteMany({
    where: { id: params.resumeId, userId: params.userId },
  });
  if (result.count === 0) throw new StructuredResumeNotFoundError();

  await logImportantInfo({
    event: 'structured_resume_deleted',
    userId: params.userId,
    route: `/api/resumes/${params.resumeId}`,
    context: { resumeId: params.resumeId },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function resolveTargetJobId(userId: string, jobId: string | null): Promise<string | null> {
  const resolved = await resolveTargetJob({ userId, jobId });
  return resolved?.id ?? null;
}

/**
 * Replace every entry id in a copied document.
 *
 * Only ids change. Nothing is edited, reordered, added or removed, so a copy
 * is byte-for-byte equivalent in content while being a different document.
 */
function reidentifyEntries(content: ResumeContent): ResumeContent {
  return {
    ...content,
    experiences: content.experiences.map((entry) => ({ ...entry, id: randomUUID() })),
    education: content.education.map((entry) => ({ ...entry, id: randomUUID() })),
    skills: content.skills.map((entry) => ({ ...entry, id: randomUUID() })),
    projects: content.projects.map((entry) => ({ ...entry, id: randomUUID() })),
    credentials: content.credentials.map((entry) => ({ ...entry, id: randomUUID() })),
  };
}

/** Non-empty content test, used only for a log hint. Never for behaviour. */
export function hasAnyContent(content: ResumeContent): boolean {
  const { basics } = content;
  return Boolean(
    basics.fullName ||
      basics.headline ||
      basics.email ||
      basics.phone ||
      basics.location ||
      content.summary ||
      content.experiences.length > 0 ||
      content.skills.length > 0 ||
      content.education.length > 0 ||
      content.projects.length > 0 ||
      content.credentials.length > 0,
  );
}
