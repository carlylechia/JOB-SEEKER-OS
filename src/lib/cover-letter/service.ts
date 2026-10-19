/**
 * Cover letter orchestration.
 *
 * This is the only module allowed to start a paid AI operation for cover
 * letters. It runs the same checks in the same order for every request, and
 * every one of them happens BEFORE we spend money:
 *
 *   1. authenticate            (the caller passes a session-derived userId)
 *   2. check the entitlement   (subscriptions.ts, timestamp-derived)
 *   3. resolve the job         (ownership-scoped; a soft-deleted job is absent)
 *   4. load profile, preferences and the resume targeted at this job
 *   5. compute deterministic inputs and the input fingerprint
 *   6. duplicate suppression   (one letter per input fingerprint is the lock)
 *   7. run the generation      (no database lock is held while we wait)
 *   8. verify                  (anti-hallucination: claims re-checked)
 *   9. record the outcome      (usage already reserved; status now updated)
 *
 * No external call ever happens inside a database transaction.
 */

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { hasPrismaUniqueViolation, getUserPreferences } from '@/lib/db-helpers';
import { buildProfileContext, type ProfileContext } from '@/lib/job-intelligence/profile-context';
import { buildDeterministicInputs, type DeterministicInputs } from '@/lib/job-intelligence/deterministic';
import { buildDeterministicBlock } from '@/lib/job-intelligence/prompt';
import { requireEntitlement, type Entitlement } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError, consumeUsage } from '@/lib/billing/usage';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import {
  CoverLetterAiError,
  resolveCoverLetterAiProvider,
  type CoverLetterAiProvider,
} from './ai-client';
import { getResume } from '@/lib/resume-builder/documents';
import { resumeContentToText } from '@/lib/resume-builder/optimization/verify';
import { verifyLetter, type ProfileEvidence } from './verify';
import {
  COVER_LETTER_ERROR_MESSAGES,
  type CoverLetterErrorCode,
  type CoverLetterData,
  COVER_LETTER_SCHEMA_VERSION,
  COVER_LETTER_PROMPT_VERSION,
} from './schema';
import {
  COVER_LETTER_PROCESSING_STALE_MS,
} from './limits';
import type { JobLead } from '@/types';

/**
 * Feature key and metered capability.
 *
 * `AI_COVER_LETTER` already existed in the monetization registry as a
 * defined but unreleased Pro capability. This release ships it rather than
 * inventing a new key — there is no new plan, no new limit and no new usage
 * table. Cover letters draw on the shared `aiCredits` allowance: one AI
 * allowance, not several competing ones.
 */
export const COVER_LETTER_FEATURE = 'AI_COVER_LETTER' as const;

export class CoverLetterNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Cover letter not found.');
    this.name = 'CoverLetterNotFoundError';
  }
}

export class DuplicateCoverLetterInFlightError extends Error {
  readonly code = 'DUPLICATE_REQUEST';
  readonly status = 409;

  constructor() {
    super('A cover letter for this job is already being generated.');
    this.name = 'DuplicateCoverLetterInFlightError';
  }
}

export type CoverLetterSummary = {
  id: string;
  jobId: string;
  title: string;
  status: string;
  schemaVersion: number;
  inputFingerprint: string;
  version: number;
  thinInputs: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RunCoverLetterResult =
  | { outcome: 'REUSED'; letter: CoverLetterSummary; data: CoverLetterData }
  | {
      outcome: 'COMPLETED';
      letter: CoverLetterSummary;
      data: CoverLetterData;
      creditsConsumed: number;
    }
  | {
      outcome: 'FAILED';
      letter: CoverLetterSummary | null;
      code: CoverLetterErrorCode;
      message: string;
      retryable: boolean;
    };

export type RunCoverLetterOptions = {
  /** Server-derived. Never read from a request body. */
  userId: string;
  jobId: string;
  /**
   * Re-run even when a completed letter exists for these exact inputs.
   * Explicitly charged as a new operation.
   */
  force?: boolean;
  route: string;
  /** Injected by tests; production always resolves the configured provider. */
  provider?: CoverLetterAiProvider;
};

// ─── Row helpers ───────────────────────────────────────────────────────────

type LetterRow = {
  id: string;
  userId: string;
  jobId: string;
  title: string;
  subject: string | null;
  content: string;
  salutation: string | null;
  signOff: string | null;
  status: string;
  schemaVersion: number;
  promptVersion: number;
  inputFingerprint: string;
  version: number;
  thinInputs: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(row: LetterRow): CoverLetterSummary {
  return {
    id: row.id,
    jobId: row.jobId,
    title: row.title,
    status: row.status,
    schemaVersion: row.schemaVersion,
    inputFingerprint: row.inputFingerprint,
    version: row.version,
    thinInputs: row.thinInputs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function findLetterByFingerprint(params: {
  userId: string;
  jobId: string;
  inputFingerprint: string;
}): Promise<LetterRow | null> {
  return prisma.coverLetter.findFirst({
    where: {
      userId: params.userId,
      jobId: params.jobId,
      inputFingerprint: params.inputFingerprint,
    },
  });
}

function isStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > COVER_LETTER_PROCESSING_STALE_MS;
}

/**
 * Claim the letter row for this exact input set.
 *
 * The unique index on (userId, jobId, inputFingerprint) is the lock. A second
 * request for the same inputs either loses the insert race — and then re-reads
 * and sees a run already in progress — or takes over a row left GENERATING by
 * a killed function once it is stale enough that nothing can be running.
 */
async function claimLetterRow(params: {
  userId: string;
  jobId: string;
  title: string;
  inputFingerprint: string;
}): Promise<{ row: LetterRow; claimed: boolean }> {
  const existing = await findLetterByFingerprint(params);

  if (!existing) {
    try {
      const created = await prisma.coverLetter.create({
        data: {
          userId: params.userId,
          jobId: params.jobId,
          title: params.title,
          content: '',
          inputFingerprint: params.inputFingerprint,
          status: 'GENERATING',
          limitations: [],
        },
      });
      return { row: created, claimed: true };
    } catch (error) {
      if (!hasPrismaUniqueViolation(error)) throw error;
      const raced = await findLetterByFingerprint(params);
      if (!raced) throw error;
      return { row: raced, claimed: false };
    }
  }

  if (existing.status === 'GENERATING' && !isStale(existing.updatedAt)) {
    return { row: existing, claimed: false };
  }

  const updated = await prisma.coverLetter.update({
    where: { id: existing.id },
    data: { status: 'GENERATING', title: params.title },
  });
  return { row: updated, claimed: true };
}

// ─── Input assembly ─────────────────────────────────────────────────────────

export type LetterInputs = {
  job: JobLead;
  preferences: Awaited<ReturnType<typeof getUserPreferences>>;
  profile: ProfileContext;
  deterministic: DeterministicInputs;
  jobText: string;
  hadJobDescription: boolean;
  resumeText: string;
  resumeId: string | null;
  resumeRevision: number;
  projectNames: string[];
  thinInputs: boolean;
  inputFingerprint: string;
};

/**
 * Load and validate everything a generation run needs.
 *
 * Identical code runs on the read path, so staleness is a fingerprint
 * comparison rather than a heuristic.
 */
export async function buildLetterInputs(params: {
  userId: string;
  jobId: string;
}): Promise<LetterInputs | null> {
  const { userId, jobId } = params;

  const preferences = await getUserPreferences(userId);
  const profile = await buildProfileContext({ userId });

  const deterministic = await buildDeterministicInputs({
    userId,
    jobId,
    preferences,
    profile,
  });
  if (!deterministic) return null;

  const { job, jobText, hadJobDescription } = deterministic;

  // The resume targeted at this job, falling back to the user's most recent
  // structured resume. A resume is optional context: a letter can still be
  // generated from the job and profile alone.
  let resumeText = '';
  let resumeId: string | null = null;
  let resumeRevision = 0;

  const targeted = await prisma.structuredResume.findFirst({
    where: { userId, targetJobId: jobId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, content: true, revision: true },
  });
  const resume = targeted ?? (await prisma.structuredResume.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, content: true, revision: true },
  }));
  if (resume) {
    resumeText = resumeContentToText(resume.content as import('@/lib/resume-builder/schema').ResumeContent);
    resumeId = resume.id;
    resumeRevision = resume.revision;
  }

  // Project names, for server-side re-checking of any "your project X"
  // reference the model suggests.
  const projects = await prisma.careerProject.findMany({
    where: { userId },
    select: { name: true },
  });
  const projectNames = projects
    .map((project) => project.name)
    .filter((name): name is string => Boolean(name));

  const thinInputs =
    jobText.length < 40 ||
    (profile.completeness === 'EMPTY' && !hadJobDescription) ||
    profile.contextText.length < 20;

  const inputFingerprint = fingerprintFor({
    job,
    profile: {
      careerProfileVersion: profile.careerProfileVersion,
      completeness: profile.completeness,
      confirmed: profile.confirmed,
    },
    resumeId,
    resumeRevision,
    jobText,
  });

  return {
    job,
    preferences,
    profile,
    deterministic,
    jobText,
    hadJobDescription,
    resumeText,
    resumeId,
    resumeRevision,
    projectNames,
    thinInputs,
    inputFingerprint,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function fingerprintFor(params: {
  job: JobLead;
  profile: Pick<ProfileContext, 'careerProfileVersion' | 'completeness' | 'confirmed'>;
  resumeId: string | null;
  resumeRevision: number;
  jobText: string;
}): string {
  const { job, profile, resumeId, resumeRevision, jobText } = params;
  const payload = {
    v: COVER_LETTER_SCHEMA_VERSION,
    prompt: COVER_LETTER_PROMPT_VERSION,
    job: {
      title: job.title.trim(),
      company: job.company.trim(),
      location: (job.location ?? '').trim(),
      remoteType: (job.remoteType ?? '').trim(),
      timezoneRequirement: (job.timezoneRequirement ?? '').trim(),
      eligibilityRegion: (job.eligibilityRegion ?? '').trim(),
      salaryMin: job.salaryMin ?? null,
      salaryMax: job.salaryMax ?? null,
      currency: (job.currency ?? 'USD').trim().toUpperCase(),
      text: jobText,
    },
    profile: {
      version: profile.careerProfileVersion,
      completeness: profile.completeness,
      confirmed: profile.confirmed,
    },
    resume: { id: resumeId, revision: resumeRevision },
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

// ─── The generation run ────────────────────────────────────────────────────

export async function runCoverLetterGeneration(
  options: RunCoverLetterOptions,
): Promise<RunCoverLetterResult> {
  const { userId, jobId, route } = options;

  // 2. Entitlement.
  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, COVER_LETTER_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'cover_letter_denied',
      userId,
      jobId,
      route,
      context: { feature: COVER_LETTER_FEATURE },
    });
    throw error;
  }

  // 3–5. Resolve inputs and fingerprint.
  const inputs = await buildLetterInputs({ userId, jobId });
  if (!inputs) {
    return {
      outcome: 'FAILED',
      letter: null,
      code: 'NO_JOB_DATA',
      message: COVER_LETTER_ERROR_MESSAGES.NO_JOB_DATA,
      retryable: false,
    };
  }

  if (inputs.jobText.length < 40) {
    await logImportantInfo({
      event: 'cover_letter_failed',
      userId,
      jobId,
      route,
      context: { code: 'NO_JOB_DATA' },
    });
    return {
      outcome: 'FAILED',
      letter: null,
      code: 'NO_JOB_DATA',
      message: COVER_LETTER_ERROR_MESSAGES.NO_JOB_DATA,
      retryable: false,
    };
  }

  await logImportantInfo({
    event: 'cover_letter_generation_started',
    userId,
    jobId,
    route,
    context: {
      force: options.force === true,
      fitScore: inputs.deterministic.fitScore,
      fitTier: inputs.deterministic.fitTier,
      profileCompleteness: inputs.profile.completeness,
      thinInputs: inputs.thinInputs,
      hadResume: inputs.resumeId !== null,
    },
  });

  // 6. Reuse is checked BEFORE the row is claimed.
  if (!options.force) {
    const reusable = await findLetterByFingerprint({
      userId,
      jobId,
      inputFingerprint: inputs.inputFingerprint,
    });
    if (reusable?.status === 'GENERATED') {
      await logImportantInfo({
        event: 'cover_letter_generation_reused',
        userId,
        jobId,
        route,
        context: { letterId: reusable.id },
      });
      const letter = await getLetterWithClaims({ userId, letterId: reusable.id });
      if (!letter) {
        return {
          outcome: 'FAILED',
          letter: null,
          code: 'AI_UNAVAILABLE',
          message: COVER_LETTER_ERROR_MESSAGES.AI_UNAVAILABLE,
          retryable: true,
        };
      }
      return { outcome: 'REUSED', letter, data: letter.data };
    }
  }

  const { row, claimed } = await claimLetterRow({
    userId,
    jobId,
    title: `${inputs.job.company} - ${inputs.job.title}`,
    inputFingerprint: inputs.inputFingerprint,
  });

  if (!claimed && row.status === 'GENERATING') {
    throw new DuplicateCoverLetterInFlightError();
  }

  // 7. Usage, reserved immediately before the provider call under the existing
  // advisory lock, so parallel requests serialise and a retry of this exact
  // input set is not charged twice.
  const idempotencyKey = options.force ? `cover-letter:${row.id}:forced` : `cover-letter:${row.id}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    await logImportantInfo({
      event: 'cover_letter_admin_bypass',
      userId,
      jobId,
      route,
      context: { letterId: row.id },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, COVER_LETTER_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'cover_letter_usage_denied',
          userId,
          jobId,
          route,
          context: { feature: COVER_LETTER_FEATURE, limit: error.limit, used: error.used },
        });
        await releaseClaim(row.id);
      }
      throw error;
    }
  }

  // 8. Provider call. No transaction is open and no row lock is held.
  let provider: CoverLetterAiProvider;
  try {
    provider = options.provider ?? resolveCoverLetterAiProvider();
  } catch (error) {
    await markFailed(row.id, error);
    return failureFor(row.id, error);
  }

  let verifiedLetter: ReturnType<typeof verifyLetter>;
  try {
    const modelLetter = await provider.generateCoverLetter({
      deterministicBlock: buildDeterministicBlock({
        jobTitle: inputs.job.title,
        jobCompany: inputs.job.company,
        fitScore: inputs.deterministic.fitScore,
        fitTier: inputs.deterministic.fitTier,
        blockedBy: inputs.deterministic.blockedBy,
        titleMatch: inputs.deterministic.titleMatch,
        titleRelationship: inputs.deterministic.titleRelationship.relationship,
        workArrangement: inputs.deterministic.workArrangement.arrangement,
        remoteCompatibility: inputs.deterministic.remoteCompatibility,
        locationCompatibility: inputs.deterministic.locationCompatibility,
        timeZoneCompatibility: inputs.deterministic.timeZoneCompatibility,
        eligibilityCompatibility: inputs.deterministic.eligibilityCompatibility,
        compensation: inputs.deterministic.compensation,
        hadJobDescription: inputs.hadJobDescription,
        dataCompleteness: inputs.deterministic.dataCompleteness,
      }),
      careerProfileBlock: inputs.profile.contextText,
      jobText: inputs.jobText,
    });

    // 9. Verify before storing. Anti-hallucination becomes real here.
    const profileEvidence: ProfileEvidence = {
      projectNames: inputs.projectNames,
      experienceTitles: inputs.profile.experienceTitles,
      skillNames: inputs.profile.skillNames,
    };

    verifiedLetter = verifyLetter({
      letter: modelLetter,
      sources: { jobText: inputs.jobText, profileText: inputs.profile.contextText },
      profile: profileEvidence,
    });
  } catch (error) {
    await markFailed(row.id, error);
    await logImportantError({
      event: 'cover_letter_generation_failed',
      userId,
      jobId,
      route,
      error,
      context: { letterId: row.id, code: error instanceof CoverLetterAiError ? error.code : 'AI_UNAVAILABLE' },
    });
    return failureFor(row.id, error);
  }

  if (!verifiedLetter) {
    await markFailed(row.id, new Error('EMPTY_LETTER'));
    return {
      outcome: 'FAILED',
      letter: null,
      code: 'AI_EMPTY_RESPONSE',
      message: COVER_LETTER_ERROR_MESSAGES.AI_EMPTY_RESPONSE,
      retryable: true,
    };
  }

  // 10. Record the outcome.
  const completed = await prisma.coverLetter.update({
    where: { id: row.id },
    data: {
      status: 'GENERATED',
      title: verifiedLetter.subject
        ? `${inputs.job.company} - ${inputs.job.title}`
        : row.title,
      content: verifiedLetter.content,
      subject: verifiedLetter.subject,
      salutation: verifiedLetter.salutation,
      signOff: verifiedLetter.signOff,
      keyClaims: verifiedLetter.keyClaims as unknown as object,
      limitations: verifiedLetter.limitations,
      thinInputs: inputs.thinInputs,
      updatedAt: new Date(),
    },
  });

  await logImportantInfo({
    event: 'cover_letter_created',
    userId,
    jobId,
    route,
    context: {
      letterId: completed.id,
      model: provider.model,
      version: completed.version,
      thinInputs: inputs.thinInputs,
      creditsConsumed,
    },
  });

  const letter = await getLetterWithClaims({ userId, letterId: completed.id });
  if (!letter) {
    return {
      outcome: 'FAILED',
      letter: toSummary(completed),
      code: 'AI_UNAVAILABLE',
      message: COVER_LETTER_ERROR_MESSAGES.AI_UNAVAILABLE,
      retryable: true,
    };
  }

  return {
    outcome: 'COMPLETED',
    letter,
    data: letter.data,
    creditsConsumed,
  };
}

async function releaseClaim(letterId: string): Promise<void> {
  await prisma.coverLetter
    .update({ where: { id: letterId }, data: { status: 'FAILED' } })
    .catch(() => undefined);
}

async function markFailed(letterId: string, error: unknown): Promise<void> {
  await prisma.coverLetter
    .update({ where: { id: letterId }, data: { status: 'FAILED' } })
    .catch(() => undefined);
}

function failureFor(
  letterId: string,
  error: unknown,
): RunCoverLetterResult {
  const code = error instanceof CoverLetterAiError ? error.code : 'AI_UNAVAILABLE';
  return {
    outcome: 'FAILED',
    letter: null,
    code: code as CoverLetterErrorCode,
    message:
      COVER_LETTER_ERROR_MESSAGES[code as keyof typeof COVER_LETTER_ERROR_MESSAGES] ??
      COVER_LETTER_ERROR_MESSAGES.AI_UNAVAILABLE,
    retryable: error instanceof CoverLetterAiError ? error.retryable : true,
  };
}

// ─── Reading ───────────────────────────────────────────────────────────────

export type LetterWithClaims = CoverLetterSummary & {
  data: CoverLetterData;
};

/**
 * Load one letter the caller owns, with its claims and limitations.
 */
export async function getLetterWithClaims(params: {
  userId: string;
  letterId: string;
}): Promise<LetterWithClaims | null> {
  const row = await prisma.coverLetter.findFirst({
    where: { id: params.letterId, userId: params.userId },
  });
  if (!row) return null;

  const data: CoverLetterData = {
    id: row.id,
    userId: row.userId,
    jobId: row.jobId,
    title: row.title,
    subject: row.subject,
    content: row.content,
    salutation: row.salutation,
    signOff: row.signOff,
    status: row.status as CoverLetterData['status'],
    schemaVersion: row.schemaVersion,
    promptVersion: row.promptVersion,
    inputFingerprint: row.inputFingerprint,
    version: row.version,
    thinInputs: row.thinInputs,
    keyClaims: (row.keyClaims as unknown as CoverLetterData['keyClaims']) ?? [],
    limitations: (row.limitations as unknown as string[]) ?? [],
  };

  return { ...toSummary(row), data };
}

/**
 * List the caller's letters, most recently updated first. Optionally scoped to
 * one job.
 */
export async function listCoverLetters(params: {
  userId: string;
  jobId?: string;
}): Promise<CoverLetterSummary[]> {
  const rows = await prisma.coverLetter.findMany({
    where: {
      userId: params.userId,
      ...(params.jobId ? { jobId: params.jobId } : {}),
      status: { not: 'FAILED' },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return rows.map((row) => toSummary(row));
}

export type UpdateCoverLetterInput = {
  title?: string;
  content?: string;
  subject?: string | null;
  salutation?: string | null;
  signOff?: string | null;
  status?: 'DRAFT' | 'GENERATED' | 'SENT' | 'ARCHIVED';
};

/**
 * Update letter metadata or content. Ownership is part of the query so another
 * user's letter is a 404, not a 403. A user edit bumps nothing AI-related;
 * content changes are the user's own writing and consume nothing.
 */
export async function updateCoverLetter(params: {
  userId: string;
  letterId: string;
  input: UpdateCoverLetterInput;
}): Promise<CoverLetterSummary | null> {
  const row = await prisma.coverLetter.findFirst({
    where: { id: params.letterId, userId: params.userId },
  });
  if (!row) return null;

  const updated = await prisma.coverLetter.update({
    where: { id: params.letterId },
    data: {
      ...(params.input.title !== undefined ? { title: params.input.title } : {}),
      ...(params.input.content !== undefined ? { content: params.input.content } : {}),
      ...(params.input.subject !== undefined ? { subject: params.input.subject } : {}),
      ...(params.input.salutation !== undefined ? { salutation: params.input.salutation } : {}),
      ...(params.input.signOff !== undefined ? { signOff: params.input.signOff } : {}),
      ...(params.input.status !== undefined ? { status: params.input.status } : {}),
    },
  });

  return toSummary(updated);
}

/**
 * Regenerate a cover letter with the same inputs, charged as a new AI
 * operation.
 *
 * The previous letter is preserved: its fingerprint is marked superseded and
 * its status set to ARCHIVED, and a new versioned row is created so the user
 * can compare versions rather than silently losing the earlier draft.
 */
export async function regenerateCoverLetter(params: {
  userId: string;
  letterId: string;
  route: string;
}): Promise<{
  letter: CoverLetterSummary;
  data: CoverLetterData;
  creditsConsumed: number;
}> {
  const { userId, letterId, route } = params;

  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, COVER_LETTER_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'cover_letter_denied',
      userId,
      route,
      context: { feature: COVER_LETTER_FEATURE, letterId },
    });
    throw error;
  }

  const existing = await prisma.coverLetter.findFirst({
    where: { id: letterId, userId },
    select: {
      id: true,
      jobId: true,
      inputFingerprint: true,
      version: true,
      status: true,
    },
  });
  if (!existing || existing.status === 'FAILED') throw new CoverLetterNotFoundError();

  const inputs = await buildLetterInputs({ userId, jobId: existing.jobId });
  if (!inputs) {
    throw new CoverLetterNotFoundError();
  }

  if (inputs.jobText.length < 40) {
    throw new Error('NO_JOB_DATA');
  }

  await logImportantInfo({
    event: 'cover_letter_regenerate_started',
    userId,
    jobId: existing.jobId,
    route,
    context: { letterId: existing.id, version: existing.version },
  });

  const idempotencyKey = `cover-letter-regenerate:${existing.id}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    await logImportantInfo({
      event: 'cover_letter_admin_bypass',
      userId,
      route,
      context: { letterId: existing.id, operation: 'regenerate' },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, COVER_LETTER_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'cover_letter_usage_denied',
          userId,
          route,
          context: { feature: COVER_LETTER_FEATURE, limit: error.limit, used: error.used, letterId: existing.id, operation: 'regenerate' },
        });
      }
      throw error;
    }
  }

  let provider: CoverLetterAiProvider;
  try {
    provider = resolveCoverLetterAiProvider();
  } catch (error) {
    await logImportantError({
      event: 'cover_letter_regenerate_failed',
      userId,
      route,
      error,
      context: { letterId: existing.id, code: 'AI_NOT_CONFIGURED' },
    });
    throw error;
  }

  let verifiedLetter: ReturnType<typeof verifyLetter>;
  try {
    const modelLetter = await provider.generateCoverLetter({
      deterministicBlock: buildDeterministicBlock({
        jobTitle: inputs.job.title,
        jobCompany: inputs.job.company,
        fitScore: inputs.deterministic.fitScore,
        fitTier: inputs.deterministic.fitTier,
        blockedBy: inputs.deterministic.blockedBy,
        titleMatch: inputs.deterministic.titleMatch,
        titleRelationship: inputs.deterministic.titleRelationship.relationship,
        workArrangement: inputs.deterministic.workArrangement.arrangement,
        remoteCompatibility: inputs.deterministic.remoteCompatibility,
        locationCompatibility: inputs.deterministic.locationCompatibility,
        timeZoneCompatibility: inputs.deterministic.timeZoneCompatibility,
        eligibilityCompatibility: inputs.deterministic.eligibilityCompatibility,
        compensation: inputs.deterministic.compensation,
        hadJobDescription: inputs.hadJobDescription,
        dataCompleteness: inputs.deterministic.dataCompleteness,
      }),
      careerProfileBlock: inputs.profile.contextText,
      jobText: inputs.jobText,
    });

    const profileEvidence: ProfileEvidence = {
      projectNames: inputs.projectNames,
      experienceTitles: inputs.profile.experienceTitles,
      skillNames: inputs.profile.skillNames,
    };

    verifiedLetter = verifyLetter({
      letter: modelLetter,
      sources: { jobText: inputs.jobText, profileText: inputs.profile.contextText },
      profile: profileEvidence,
    });
  } catch (error) {
    await logImportantError({
      event: 'cover_letter_regenerate_failed',
      userId,
      route,
      error,
      context: { letterId: existing.id, code: error instanceof CoverLetterAiError ? error.code : 'AI_UNAVAILABLE' },
    });
    throw error;
  }

  if (!verifiedLetter) {
    throw new Error('AI_EMPTY_RESPONSE');
  }

  // Preserve the previous letter: mark it superseded and archived, then create
  // a new versioned row so both versions exist side by side.
  const supersededFingerprint = `${existing.inputFingerprint}:superseded-${existing.version}`;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.coverLetter.update({
      where: { id: existing.id },
      data: {
        inputFingerprint: supersededFingerprint,
        status: 'ARCHIVED',
      },
    });

    return tx.coverLetter.create({
      data: {
        userId,
        jobId: existing.jobId,
        title: `${inputs.job.company} - ${inputs.job.title}`,
        content: verifiedLetter.content,
        subject: verifiedLetter.subject,
        salutation: verifiedLetter.salutation,
        signOff: verifiedLetter.signOff,
        inputFingerprint: inputs.inputFingerprint,
        version: existing.version + 1,
        keyClaims: verifiedLetter.keyClaims as unknown as object,
        limitations: verifiedLetter.limitations,
        thinInputs: inputs.thinInputs,
        status: 'GENERATED',
      },
    });
  });

  await logImportantInfo({
    event: 'cover_letter_regenerated',
    userId,
    jobId: existing.jobId,
    route,
    context: {
      letterId: updated.id,
      previousLetterId: existing.id,
      model: provider.model,
      version: updated.version,
      creditsConsumed,
    },
  });

  const letter = await getLetterWithClaims({ userId, letterId: updated.id });
  if (!letter) {
    throw new CoverLetterNotFoundError();
  }

  return { letter, data: letter.data, creditsConsumed };
}
