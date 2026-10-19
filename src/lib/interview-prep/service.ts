/**
 * Interview preparation orchestration.
 *
 * This is the only module allowed to start a paid AI operation for interview
 * preparation. It runs the same checks in the same order for every request,
 * and every one of them happens BEFORE we spend money:
 *
 *   1. authenticate            (the caller passes a session-derived userId)
 *   2. check the entitlement   (subscriptions.ts, timestamp-derived)
 *   3. resolve the job         (ownership-scoped; a soft-deleted job is absent)
 *   4. load profile, preferences and the resume targeted at this job
 *   5. compute deterministic inputs and the input fingerprint
 *   6. duplicate suppression   (one pack per input fingerprint is the lock)
 *   7. run the generation      (no database lock is held while we wait)
 *   8. record the outcome      (usage already reserved; status now updated)
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
  InterviewPrepAiError,
  resolveInterviewPrepAiProvider,
  type InterviewPrepAiProvider,
} from './ai-client';
import { getResume } from '@/lib/resume-builder/documents';
import { resumeContentToText } from '@/lib/resume-builder/optimization/verify';
import type { ResumeContent } from '@/lib/resume-builder/schema';
import type { ModelDimensionRating } from './schema';
import { Prisma } from '@prisma/client';
import { verifyPack, verifyFeedback, type ProfileEvidence } from './verify';
import {
  INTERVIEW_PREP_ERROR_MESSAGES,
  type InterviewPrepErrorCode,
  type InterviewPrepPackData,
  type QuestionCategory,
  type Difficulty,
  type AnswerStructure,
  type RubricDimension,
  INTERVIEW_PREP_SCHEMA_VERSION,
  INTERVIEW_PREP_PROMPT_VERSION,
} from './schema';
import {
  INTERVIEW_PREP_MAX_QUESTIONS,
  INTERVIEW_PREP_PROCESSING_STALE_MS,
} from './limits';
import type { JobLead } from '@/types';

/**
 * Feature key and metered capability.
 *
 * `AI_INTERVIEW_PREP` already existed in the monetization registry as a
 * defined but unreleased Pro capability. This release ships it rather than
 * inventing a new key — there is no new plan, no new limit and no new usage
 * table. Pack generation and practice feedback both draw on the shared
 * `aiCredits` allowance: one AI allowance, not several competing ones.
 */
export const INTERVIEW_PREP_FEATURE = 'AI_INTERVIEW_PREP' as const;

export class InterviewPrepPackNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Preparation pack not found.');
    this.name = 'InterviewPrepPackNotFoundError';
  }
}

export class DuplicatePrepGenerationInFlightError extends Error {
  readonly code = 'DUPLICATE_REQUEST';
  readonly status = 409;

  constructor() {
    super('A preparation pack for this job is already being generated.');
    this.name = 'DuplicatePrepGenerationInFlightError';
  }
}

export class PracticeAnswerTooShortError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;

  constructor() {
    super('Write a bit more before requesting feedback — a few sentences gives something useful to evaluate.');
    this.name = 'PracticeAnswerTooShortError';
  }
}

export type PrepPackSummary = {
  id: string;
  jobId: string;
  title: string;
  context: string;
  status: string;
  schemaVersion: number;
  inputFingerprint: string;
  questionCount: number;
  practicedCount: number;
  feedbackCount: number;
  lastPracticedAt: Date | null;
  isFresh: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RunPrepGenerationResult =
  | { outcome: 'REUSED'; pack: PrepPackSummary; data: InterviewPrepPackData }
  | {
      outcome: 'COMPLETED';
      pack: PrepPackSummary;
      data: InterviewPrepPackData;
      creditsConsumed: number;
    }
  | {
      outcome: 'FAILED';
      pack: PrepPackSummary | null;
      code: InterviewPrepErrorCode;
      message: string;
      retryable: boolean;
    };

export type RunPrepGenerationOptions = {
  /** Server-derived. Never read from a request body. */
  userId: string;
  jobId: string;
  /** Selected interview context; BALANCED when the stage is unknown. */
  context: string;
  /**
   * Re-run even when a completed pack exists for these exact inputs.
   * Explicitly charged as a new operation.
   */
  force?: boolean;
  route: string;
  /** Injected by tests; production always resolves the configured provider. */
  provider?: InterviewPrepAiProvider;
};

// ─── Row helpers ───────────────────────────────────────────────────────────

type PackRow = {
  id: string;
  userId: string;
  jobId: string;
  title: string;
  context: string;
  status: string;
  schemaVersion: number;
  promptVersion: number;
  inputFingerprint: string;
  questionCount: number;
  practicedCount: number;
  feedbackCount: number;
  lastPracticedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(row: PackRow, isFresh: boolean): PrepPackSummary {
  return {
    id: row.id,
    jobId: row.jobId,
    title: row.title,
    context: row.context,
    status: row.status,
    schemaVersion: row.schemaVersion,
    inputFingerprint: row.inputFingerprint,
    questionCount: row.questionCount,
    practicedCount: row.practicedCount,
    feedbackCount: row.feedbackCount,
    lastPracticedAt: row.lastPracticedAt,
    isFresh,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function findPackByFingerprint(params: {
  userId: string;
  jobId: string;
  inputFingerprint: string;
}): Promise<PackRow | null> {
  return prisma.interviewPrepPack.findFirst({
    where: {
      userId: params.userId,
      jobId: params.jobId,
      inputFingerprint: params.inputFingerprint,
    },
  });
}

function isStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > INTERVIEW_PREP_PROCESSING_STALE_MS;
}

/**
 * Claim the pack row for this exact input set.
 *
 * The unique index on (userId, jobId, inputFingerprint) is the lock. A second
 * request for the same inputs either loses the insert race — and then re-reads
 * and sees a run already in progress — or takes over a row left GENERATING by
 * a killed function once it is stale enough that nothing can be running.
 */
async function claimPackRow(params: {
  userId: string;
  jobId: string;
  title: string;
  context: string;
  inputFingerprint: string;
}): Promise<{ row: PackRow; claimed: boolean }> {
  const existing = await findPackByFingerprint(params);

  if (!existing) {
    try {
      const created = await prisma.interviewPrepPack.create({
        data: {
          userId: params.userId,
          jobId: params.jobId,
          title: params.title,
          context: params.context,
          inputFingerprint: params.inputFingerprint,
          status: 'GENERATING',
          limitations: [],
        },
      });
      return { row: created, claimed: true };
    } catch (error) {
      if (!hasPrismaUniqueViolation(error)) throw error;
      const raced = await findPackByFingerprint(params);
      if (!raced) throw error;
      return { row: raced, claimed: false };
    }
  }

  if (existing.status === 'GENERATING' && !isStale(existing.updatedAt)) {
    return { row: existing, claimed: false };
  }

  // A completed row is NOT re-claimed here. Overwriting it would destroy the
  // pack the caller is about to reuse. Callers check for a reusable result
  // before claiming.
  const updated = await prisma.interviewPrepPack.update({
    where: { id: existing.id },
    data: { status: 'GENERATING', title: params.title, context: params.context },
  });
  return { row: updated, claimed: true };
}

// ─── Input assembly ─────────────────────────────────────────────────────────

export type PrepInputs = {
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
export async function buildPrepInputs(params: {
  userId: string;
  jobId: string;
  context: string;
}): Promise<PrepInputs | null> {
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
  // structured resume. A resume is optional context: a pack can still be
  // generated from the job and profile alone.
  let resumeText = '';
  let resumeId: string | null = null;
  let resumeRevision = 0;

  let resumeRecord: { id: string; content: unknown; revision: number } | null = null;

  const targeted = await prisma.structuredResume.findFirst({
    where: { userId, targetJobId: jobId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, content: true, revision: true },
  });
  const resume = targeted ?? (await prisma.structuredResume.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' }, select: { id: true, content: true, revision: true } }));
  if (resume) {
    resumeText = resumeContentToText(resume.content as ResumeContent);
    resumeId = resume.id;
    resumeRevision = resume.revision;
    resumeRecord = resume;
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
    context: params.context,
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
  context: string;
  resumeId: string | null;
  resumeRevision: number;
  jobText: string;
}): string {
  const { job, profile, context, resumeId, resumeRevision, jobText } = params;
  const payload = {
    v: INTERVIEW_PREP_SCHEMA_VERSION,
    prompt: INTERVIEW_PREP_PROMPT_VERSION,
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
    context,
    resume: { id: resumeId, revision: resumeRevision },
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

// ─── Rubric selection ──────────────────────────────────────────────────────

/**
 * Which feedback rubric dimensions apply to each question category.
 *
 * Unrelated dimensions are never scored: a debugging answer is not marked
 * down for lacking a STAR structure, and a recruiter-screen answer is not
 * marked down for system-design trade-offs.
 */
export function rubricDimensionsForCategory(category: QuestionCategory): RubricDimension[] {
  const base: RubricDimension[] = ['RELEVANCE', 'CLARITY_STRUCTURE', 'COMMUNICATION', 'COMPLETENESS'];

  switch (category) {
    case 'BEHAVIORAL':
      return [...base, 'CONCRETE_EXAMPLE', 'ROLE_SKILLS', 'SUPPORTED_OUTCOMES'];
    case 'TECHNICAL_FUNDAMENTALS':
    case 'APPLIED_PROBLEM_SOLVING':
      return [...base, 'TECHNICAL_CORRECTNESS', 'REASONING_TRADE_OFFS'];
    case 'ARCHITECTURE_TRADE_OFFS':
      return [...base, 'REASONING_TRADE_OFFS', 'ROLE_SKILLS'];
    case 'DEBUGGING':
      return [...base, 'TECHNICAL_CORRECTNESS', 'REASONING_TRADE_OFFS'];
    case 'PROJECT_DECISIONS':
    case 'COLLABORATION':
    case 'OWNERSHIP':
      return [...base, 'CONCRETE_EXAMPLE', 'ROLE_SKILLS'];
    case 'HANDLING_AMBIGUITY':
      return [...base, 'REASONING_TRADE_OFFS', 'COMMUNICATION'];
    case 'ROLE_SCENARIO':
      return [...base, 'ROLE_SKILLS', 'TECHNICAL_CORRECTNESS'];
    case 'EMPLOYER_QUESTIONS':
      return base;
    default:
      return base;
  }
}

// ─── The generation run ────────────────────────────────────────────────────

export async function runInterviewPrepGeneration(
  options: RunPrepGenerationOptions,
): Promise<RunPrepGenerationResult> {
  const { userId, jobId, route } = options;

  // 2. Entitlement.
  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, INTERVIEW_PREP_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'interview_entitlement_denied',
      userId,
      jobId,
      route,
      context: { feature: INTERVIEW_PREP_FEATURE },
    });
    throw error;
  }

  // 3–5. Resolve inputs and fingerprint.
  const inputs = await buildPrepInputs({ userId, jobId, context: options.context });
  if (!inputs) {
    return {
      outcome: 'FAILED',
      pack: null,
      code: 'NO_JOB_DATA',
      message: INTERVIEW_PREP_ERROR_MESSAGES.NO_JOB_DATA,
      retryable: false,
    };
  }

  if (inputs.jobText.length < 40) {
    await logImportantInfo({
      event: 'interview_prep_failed',
      userId,
      jobId,
      route,
      context: { code: 'NO_JOB_DATA' },
    });
    return {
      outcome: 'FAILED',
      pack: null,
      code: 'NO_JOB_DATA',
      message: INTERVIEW_PREP_ERROR_MESSAGES.NO_JOB_DATA,
      retryable: false,
    };
  }

  await logImportantInfo({
    event: 'interview_pack_generation_started',
    userId,
    jobId,
    route,
    context: {
      force: options.force === true,
      context: options.context,
      fitScore: inputs.deterministic.fitScore,
      fitTier: inputs.deterministic.fitTier,
      profileCompleteness: inputs.profile.completeness,
      thinInputs: inputs.thinInputs,
      hadResume: inputs.resumeId !== null,
    },
  });

  // 6. Reuse is checked BEFORE the row is claimed.
  if (!options.force) {
    const reusable = await findPackByFingerprint({
      userId,
      jobId,
      inputFingerprint: inputs.inputFingerprint,
    });
    if (reusable?.status === 'ACTIVE') {
      await logImportantInfo({
        event: 'interview_pack_generation_reused',
        userId,
        jobId,
        route,
        context: { packId: reusable.id },
      });
      const pack = await getPackWithQuestions({ userId, packId: reusable.id });
      if (!pack) {
        return {
          outcome: 'FAILED',
          pack: null,
          code: 'AI_UNAVAILABLE',
          message: INTERVIEW_PREP_ERROR_MESSAGES.AI_UNAVAILABLE,
          retryable: true,
        };
      }
      return { outcome: 'REUSED', pack, data: pack.data };
    }
  }

  const { row, claimed } = await claimPackRow({
    userId,
    jobId,
    title: `${inputs.job.company} - ${inputs.job.title}`,
    context: options.context,
    inputFingerprint: inputs.inputFingerprint,
  });

  if (!claimed && row.status === 'GENERATING') {
    throw new DuplicatePrepGenerationInFlightError();
  }

  // 7. Usage, reserved immediately before the provider call under the existing
  // advisory lock, so parallel requests serialise and a retry of this exact
  // input set is not charged twice.
  const idempotencyKey = options.force ? `interview-prep:${row.id}:forced` : `interview-prep:${row.id}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    await logImportantInfo({
      event: 'interview_prep_admin_bypass',
      userId,
      jobId,
      route,
      context: { packId: row.id },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, INTERVIEW_PREP_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'interview_usage_denied',
          userId,
          jobId,
          route,
          context: { feature: INTERVIEW_PREP_FEATURE, limit: error.limit, used: error.used },
        });
        await releaseClaim(row.id);
      }
      throw error;
    }
  }

  // 8. Provider call. No transaction is open and no row lock is held.
  let provider: InterviewPrepAiProvider;
  try {
    provider = options.provider ?? resolveInterviewPrepAiProvider();
  } catch (error) {
    await markFailed(row.id, error);
    return failureFor(row.id, error);
  }

  let verifiedPack: ReturnType<typeof verifyPack>;
  try {
    const modelPack = await provider.generatePack({
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
      context: options.context,
      maxQuestions: INTERVIEW_PREP_MAX_QUESTIONS,
    });

    // 9. Verify before storing. Anti-fabrication becomes real here.
    const profileEvidence: ProfileEvidence = {
      projectNames: inputs.projectNames,
      experienceTitles: inputs.profile.experienceTitles,
      skillNames: inputs.profile.skillNames,
    };

    verifiedPack = verifyPack({
      pack: modelPack,
      sources: { jobText: inputs.jobText, profileText: inputs.profile.contextText },
      profile: profileEvidence,
    });
  } catch (error) {
    await markFailed(row.id, error);
    await logImportantError({
      event: 'interview_pack_generation_failed',
      userId,
      jobId,
      route,
      error,
      context: { packId: row.id, code: error instanceof InterviewPrepAiError ? error.code : 'AI_UNAVAILABLE' },
    });
    return failureFor(row.id, error);
  }

  // 10. Record the outcome: pack row + question rows, in one transaction.
  const completed = await prisma.$transaction(async (tx) => {
    const pack = await tx.interviewPrepPack.update({
      where: { id: row.id },
      data: {
        status: 'ACTIVE',
        title: verifiedPack.title || row.title,
        preparationGuidance: verifiedPack.preparationGuidance ?? null,
        limitations: verifiedPack.limitations,
        questionCount: verifiedPack.questions.length,
        updatedAt: new Date(),
      },
    });

    await tx.interviewQuestion.createMany({
      data: verifiedPack.questions.map((question, ordinal) => ({
        packId: pack.id,
        version: 1,
        ordinal,
        category: question.category,
        difficulty: question.difficulty,
        competency: question.competency,
        question: question.question,
        whyMatters: question.whyMatters,
        relatedRequirement: question.relatedRequirement,
        relevantExperience: question.relevantExperience,
        prepNotes: question.prepNotes,
        answerStructure: question.answerStructure as AnswerStructure | null,
        followUpQuestionIds: question.followUpQuestions,
        sourceType: 'GENERATED',
        sourceEvidence: question.sourceEvidence,
        isActive: true,
      })),
    });

    return pack;
  });

  await logImportantInfo({
    event: 'interview_pack_created',
    userId,
    jobId,
    route,
    context: {
      packId: completed.id,
      model: provider.model,
      questions: verifiedPack.questions.length,
      context: options.context,
      creditsConsumed,
      thinInputs: inputs.thinInputs,
    },
  });

  await logImportantInfo({
    event: 'interview_question_generated',
    userId,
    jobId,
    route,
    context: { packId: completed.id, count: verifiedPack.questions.length },
  });

  const pack = await getPackWithQuestions({ userId, packId: completed.id });
  if (!pack) {
    return {
      outcome: 'FAILED',
      pack: toSummary(completed as unknown as PackRow, true),
      code: 'AI_UNAVAILABLE',
      message: INTERVIEW_PREP_ERROR_MESSAGES.AI_UNAVAILABLE,
      retryable: true,
    };
  }

  return {
    outcome: 'COMPLETED',
    pack,
    data: pack.data,
    creditsConsumed,
  };
}

async function releaseClaim(packId: string): Promise<void> {
  await prisma.interviewPrepPack
    .update({ where: { id: packId }, data: { status: 'FAILED' } })
    .catch(() => undefined);
}

async function markFailed(packId: string, error: unknown): Promise<void> {
  await prisma.interviewPrepPack
    .update({ where: { id: packId }, data: { status: 'FAILED' } })
    .catch(() => undefined);
}

function failureFor(
  packId: string,
  error: unknown,
): RunPrepGenerationResult {
  const code = (error instanceof InterviewPrepAiError ? error.code : 'AI_UNAVAILABLE') as InterviewPrepErrorCode;
  return {
    outcome: 'FAILED',
    pack: null,
    code,
    message:
      INTERVIEW_PREP_ERROR_MESSAGES[code as keyof typeof INTERVIEW_PREP_ERROR_MESSAGES] ??
      INTERVIEW_PREP_ERROR_MESSAGES.AI_UNAVAILABLE,
    retryable: error instanceof InterviewPrepAiError ? error.retryable : true,
  };
}

// ─── Reading ───────────────────────────────────────────────────────────────

export type PackWithQuestions = PrepPackSummary & {
  data: InterviewPrepPackData;
};

/**
 * Load one pack the caller owns, with its active questions.
 *
 * isFresh is recomputed on every read: when the job, profile, resume or
 * context changes underneath the pack, the UI offers a refresh instead of
 * silently serving stale questions. Practice attempts are never touched by a
 * refresh.
 */
export async function getPackWithQuestions(params: {
  userId: string;
  packId: string;
}): Promise<PackWithQuestions | null> {
  const row = await prisma.interviewPrepPack.findFirst({
    where: { id: params.packId, userId: params.userId },
    include: {
      questions: { where: { isActive: true }, orderBy: { ordinal: 'asc' } },
    },
  });
  if (!row) return null;

  // Staleness: rebuild the current input fingerprint for the target job and
  // compare. A pack is stale when the inputs that produced it have changed.
  const current = await buildPrepInputs({ userId: params.userId, jobId: row.jobId, context: row.context });
  const isFresh = Boolean(current && current.inputFingerprint === row.inputFingerprint);

  const data: InterviewPrepPackData = {
    id: row.id,
    userId: row.userId,
    jobId: row.jobId,
    title: row.title,
    context: row.context as InterviewPrepPackData['context'],
    status: row.status as InterviewPrepPackData['status'],
    schemaVersion: row.schemaVersion,
    promptVersion: row.promptVersion,
    inputFingerprint: row.inputFingerprint,
    questions: row.questions.map((q) => ({
      id: q.id,
      version: q.version,
      ordinal: q.ordinal,
      category: q.category as QuestionCategory,
      difficulty: q.difficulty as Difficulty,
      competency: q.competency,
      question: q.question,
      whyMatters: q.whyMatters ?? '',
      relatedRequirement: q.relatedRequirement ?? null,
      relevantExperience: q.relevantExperience ?? null,
      prepNotes: q.prepNotes ?? null,
      answerStructure: q.answerStructure as AnswerStructure | null,
      followUpQuestionIds: (q.followUpQuestionIds as unknown[]) as string[],
      sourceType: q.sourceType as 'GENERATED' | 'MANUAL' | 'EDITED',
      sourceEvidence: q.sourceEvidence ?? null,
      isActive: q.isActive,
    })) as InterviewPrepPackData['questions'],
    preparationGuidance: row.preparationGuidance ?? null,
    limitations: (row.limitations as unknown as string[]) ?? [],
  };

  return { ...toSummary(row, isFresh), data };
}

/**
 * List the caller's packs, most recently updated first. Optionally scoped to
 * one job.
 */
export async function listPrepPacks(params: {
  userId: string;
  jobId?: string;
}): Promise<PrepPackSummary[]> {
  const rows = await prisma.interviewPrepPack.findMany({
    where: {
      userId: params.userId,
      ...(params.jobId ? { jobId: params.jobId } : {}),
      status: { not: 'FAILED' },
    },
    orderBy: { updatedAt: 'desc' },
  });

  // Staleness is computed per pack lazily by the UI via getPackWithQuestions;
  // here we keep the list query cheap and mark freshness as unknown.
  return rows.map((row) => toSummary(row, true));
}

export type UpdatePrepPackInput = {
  title?: string;
  context?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
};

/**
 * Update pack metadata. Ownership is part of the query so another user's pack
 * is a 404, not a 403.
 */
export async function updatePrepPack(params: {
  userId: string;
  packId: string;
  input: UpdatePrepPackInput;
}): Promise<PrepPackSummary | null> {
  const row = await prisma.interviewPrepPack.findFirst({
    where: { id: params.packId, userId: params.userId },
  });
  if (!row) return null;

  const updated = await prisma.interviewPrepPack.update({
    where: { id: params.packId },
    data: {
      ...(params.input.title !== undefined ? { title: params.input.title } : {}),
      ...(params.input.context !== undefined ? { context: params.input.context } : {}),
      ...(params.input.status !== undefined ? { status: params.input.status } : {}),
    },
  });

  return toSummary(updated, true);
}

// ─── Practice ──────────────────────────────────────────────────────────────

export type PracticeAttempt = {
  id: string;
  packId: string;
  questionId: string;
  questionVersion: number;
  attemptNumber: number;
  answer: string;
  feedback: string | null;
  rubricKey: string | null;
  createdAt: Date;
};

export type QuestionForPractice = {
  id: string;
  version: number;
  ordinal: number;
  category: QuestionCategory;
  difficulty: Difficulty;
  competency: string;
  question: string;
  whyMatters: string;
  relatedRequirement: string | null;
  relevantExperience: string | null;
  prepNotes: string | null;
  answerStructure: AnswerStructure | null;
  sourceType: string;
  sourceEvidence: string | null;
};

/**
 * Resolve one question the caller can practice, with their latest attempt.
 */
export async function getQuestionForPractice(params: {
  userId: string;
  packId: string;
  questionId: string;
}): Promise<{ question: QuestionForPractice; attempt: PracticeAttempt | null } | null> {
  const pack = await prisma.interviewPrepPack.findFirst({
    where: { id: params.packId, userId: params.userId },
    select: { id: true },
  });
  if (!pack) return null;

  const question = await prisma.interviewQuestion.findFirst({
    where: { id: params.questionId, packId: params.packId, isActive: true },
    select: {
      id: true,
      version: true,
      ordinal: true,
      category: true,
      difficulty: true,
      competency: true,
      question: true,
      whyMatters: true,
      relatedRequirement: true,
      relevantExperience: true,
      prepNotes: true,
      answerStructure: true,
      sourceType: true,
      sourceEvidence: true,
    },
  });
  if (!question) return null;

  const attempt = await prisma.interviewPracticeAttempt.findFirst({
    where: { userId: params.userId, packId: params.packId, questionId: params.questionId },
    orderBy: { attemptNumber: 'desc' },
  });

  return {
    question: {
      id: question.id,
      version: question.version,
      ordinal: question.ordinal,
      category: question.category as QuestionCategory,
      difficulty: question.difficulty as Difficulty,
      competency: question.competency,
      question: question.question,
      whyMatters: question.whyMatters ?? '',
      relatedRequirement: question.relatedRequirement ?? null,
      relevantExperience: question.relevantExperience ?? null,
      prepNotes: question.prepNotes ?? null,
      answerStructure: question.answerStructure as AnswerStructure | null,
      sourceType: question.sourceType,
      sourceEvidence: question.sourceEvidence ?? null,
    },
    attempt: attempt
      ? {
          id: attempt.id,
          packId: attempt.packId,
          questionId: attempt.questionId,
          questionVersion: attempt.questionVersion,
          attemptNumber: attempt.attemptNumber,
          answer: attempt.answer,
          feedback: attemptFeedback(attempt),
          rubricKey: attempt.rubricKey ?? null,
          createdAt: attempt.createdAt,
        }
      : null,
  };
}

function attemptFeedback(attempt: { feedback: unknown }): string | null {
  if (!attempt.feedback) return null;
  try {
    return JSON.stringify(attempt.feedback);
  } catch {
    return null;
  }
}

/**
 * Save (or replace) the candidate's draft answer for one question.
 *
 * Each submission becomes a new numbered attempt; previous attempts are kept
 * so a user can revisit and compare them. Drafts are not an AI operation and
 * consume nothing.
 */
export async function submitPracticeAnswer(params: {
  userId: string;
  packId: string;
  questionId: string;
  answer: string;
}): Promise<PracticeAttempt> {
  const { userId, packId, questionId, answer } = params;

  const pack = await prisma.interviewPrepPack.findFirst({
    where: { id: packId, userId },
    select: { id: true },
  });
  if (!pack) throw new InterviewPrepPackNotFoundError();

  const question = await prisma.interviewQuestion.findFirst({
    where: { id: questionId, packId, isActive: true },
    select: { id: true, version: true },
  });
  if (!question) throw new InterviewPrepPackNotFoundError();

  const trimmed = answer.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    throw new PracticeAnswerTooShortError();
  }

  const previous = await prisma.interviewPracticeAttempt.findFirst({
    where: { userId, packId, questionId },
    orderBy: { attemptNumber: 'desc' },
    select: { attemptNumber: true },
  });

  const attempt = await prisma.interviewPracticeAttempt.create({
    data: {
      userId,
      packId,
      questionId,
      questionVersion: question.version,
      answer: trimmed,
      attemptNumber: (previous?.attemptNumber ?? 0) + 1,
    },
  });

  await updatePackProgressOnPractice(packId);

  return {
    id: attempt.id,
    packId: attempt.packId,
    questionId: attempt.questionId,
    questionVersion: attempt.questionVersion,
    attemptNumber: attempt.attemptNumber,
    answer: attempt.answer,
    feedback: null,
    rubricKey: null,
    createdAt: attempt.createdAt,
  };
}

/**
 * Generate feedback for one submitted answer. Metered AI operation.
 *
 * The answer must exist and be long enough to evaluate; otherwise the caller
 * gets a 422 rather than a meaningless score.
 */
export async function generatePracticeFeedback(params: {
  userId: string;
  packId: string;
  attemptId: string;
  route: string;
}): Promise<{
  attempt: PracticeAttempt;
  feedback: {
    dimensions: Array<{
      dimension: RubricDimension;
      rating: string;
      note: string;
      evidenceQuote: string | null;
    }>;
    whatWorked: string;
    needsImprovement: string;
    missing: string;
    structureSuggestion: string;
    followUpPractice: string[];
    limitations: string | null;
  };
  creditsConsumed: number;
}> {
  const { userId, packId, attemptId, route } = params;

  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, INTERVIEW_PREP_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'interview_entitlement_denied',
      userId,
      route,
      context: { feature: INTERVIEW_PREP_FEATURE, attemptId },
    });
    throw error;
  }

  const attemptRow = await prisma.interviewPracticeAttempt.findFirst({
    where: { id: attemptId, userId, packId },
    include: {
      question: true,
      pack: { select: { job: { select: { title: true, company: true } } } },
    },
  });
  if (!attemptRow) throw new InterviewPrepPackNotFoundError();

  const answer = attemptRow.answer;
  if (!answer || answer.length < 30) {
    throw new PracticeAnswerTooShortError();
  }

  const questionCategory = attemptRow.question.category as QuestionCategory;
  const dimensions = rubricDimensionsForCategory(questionCategory);
  const framework = attemptRow.question.answerStructure as AnswerStructure | null;

  const idempotencyKey = `interview-feedback:${attemptId}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    await logImportantInfo({
      event: 'interview_prep_admin_bypass',
      userId,
      route,
      context: { attemptId },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, INTERVIEW_PREP_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'interview_usage_denied',
          userId,
          route,
          context: { feature: INTERVIEW_PREP_FEATURE, limit: error.limit, used: error.used, attemptId },
        });
      }
      throw error;
    }
  }

  let provider: InterviewPrepAiProvider;
  try {
    provider = resolveInterviewPrepAiProvider();
  } catch (error) {
    await logImportantError({
      event: 'interview_feedback_failed',
      userId,
      route,
      error,
      context: { attemptId, code: 'AI_NOT_CONFIGURED' },
    });
    throw error;
  }

  let feedback: ReturnType<typeof verifyFeedback>;
  try {
    const modelFeedback = await provider.generateFeedback({
      question: attemptRow.question.question,
      category: questionCategory,
      answer,
      jobTitle: attemptRow.pack.job.title,
      jobCompany: attemptRow.pack.job.company,
      dimensions,
      framework,
    });

    feedback = verifyFeedback({
      feedback: modelFeedback,
      answerText: answer,
    });
  } catch (error) {
    await logImportantError({
      event: 'interview_feedback_failed',
      userId,
      route,
      error,
      context: { attemptId, code: error instanceof InterviewPrepAiError ? error.code : 'AI_UNAVAILABLE' },
    });
    throw error;
  }

  const updated = await prisma.interviewPracticeAttempt.update({
    where: { id: attemptId },
    data: {
      feedback: {
        dimensions: feedback.dimensions,
        whatWorked: feedback.whatWorked,
        needsImprovement: feedback.needsImprovement,
        missing: feedback.missing,
        structureSuggestion: feedback.structureSuggestion,
        followUpPractice: feedback.followUpPractice,
        limitations: feedback.limitations,
      },
      rubricKey: dimensions.join(','),
    },
  });

  await prisma.interviewPrepPack.update({
    where: { id: packId },
    data: {
      feedbackCount: { increment: 1 },
      lastPracticedAt: new Date(),
      practicedCount: {
        // Count distinct questions that have at least one attempt with feedback.
        // Set directly from a fresh count so concurrent updates stay sane.
      },
    },
  });

  await updatePackProgressOnPractice(packId);

  await logImportantInfo({
    event: 'interview_feedback_generated',
    userId,
    route,
    context: { attemptId, packId, questionId: attemptRow.questionId, creditsConsumed },
  });

  return {
    attempt: {
      id: updated.id,
      packId: updated.packId,
      questionId: updated.questionId,
      questionVersion: updated.questionVersion,
      attemptNumber: updated.attemptNumber,
      answer: updated.answer,
      feedback: updated.feedback ? String(updated.feedback) : null,
      rubricKey: updated.rubricKey ?? null,
      createdAt: updated.createdAt,
    },
    feedback: {
      dimensions: feedback.dimensions.map((d: ModelDimensionRating) => ({
        dimension: d.dimension,
        rating: d.rating,
        note: d.note,
        evidenceQuote: d.evidenceQuote,
      })),
      whatWorked: feedback.whatWorked,
      needsImprovement: feedback.needsImprovement,
      missing: feedback.missing,
      structureSuggestion: feedback.structureSuggestion,
      followUpPractice: feedback.followUpPractice,
      limitations: feedback.limitations,
    },
    creditsConsumed,
  };
}

async function updatePackProgressOnPractice(packId: string): Promise<void> {
  const [attempted, withFeedback] = await Promise.all([
    prisma.interviewPracticeAttempt.groupBy({
      by: ['questionId'],
      where: { packId },
      _count: { id: true },
    }),
    prisma.interviewPracticeAttempt.groupBy({
      by: ['questionId'],
      where: { packId, feedback: { not: Prisma.DbNull } },
      _count: { id: true },
    }),
  ]);
  const questionCount = await prisma.interviewQuestion.count({ where: { packId, isActive: true } });

  await prisma.interviewPrepPack.update({
    where: { id: packId },
    data: {
      practicedCount: attempted.length,
      feedbackCount: withFeedback.length,
      lastPracticedAt: new Date(),
      questionCount,
    },
  });
}

/**
 * Progress for one pack: real, persisted activity only. No streaks, no badges,
 * no readiness claims.
 */
export type PrepProgress = {
  packId: string;
  questionCount: number;
  answeredCount: number;
  practicedCount: number;
  feedbackCount: number;
  outstandingCount: number;
  lastPracticedAt: Date | null;
};

export async function getPrepProgress(params: {
  userId: string;
  packId: string;
}): Promise<PrepProgress | null> {
  const pack = await prisma.interviewPrepPack.findFirst({
    where: { id: params.packId, userId: params.userId },
    select: {
      id: true,
      questionCount: true,
      practicedCount: true,
      feedbackCount: true,
      lastPracticedAt: true,
    },
  });
  if (!pack) return null;

  const answeredRows = await prisma.interviewPracticeAttempt.groupBy({
    by: ['questionId'],
    where: { packId: params.packId },
    _count: { id: true },
  });
  const answeredCount = answeredRows.length;

  return {
    packId: pack.id,
    questionCount: pack.questionCount,
    answeredCount,
    practicedCount: pack.practicedCount,
    feedbackCount: pack.feedbackCount,
    outstandingCount: Math.max(0, pack.questionCount - answeredCount),
    lastPracticedAt: pack.lastPracticedAt,
  };
}

/**
 * Refresh the questions of an existing pack by re-running generation against
 * the same inputs. Charged as a new operation.
 *
 * Previous questions are deactivated (not deleted) so the practice attempts
 * that used them stay attached to the question versions they were taken
 * against. New questions are inserted with an incremented version number.
 */
export async function refreshPackQuestions(params: {
  userId: string;
  packId: string;
  route: string;
}): Promise<{
  pack: PrepPackSummary;
  data: InterviewPrepPackData;
  creditsConsumed: number;
}> {
  const { userId, packId, route } = params;

  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, INTERVIEW_PREP_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'interview_entitlement_denied',
      userId,
      route,
      context: { feature: INTERVIEW_PREP_FEATURE, packId },
    });
    throw error;
  }

  const pack = await prisma.interviewPrepPack.findFirst({
    where: { id: packId, userId },
    select: { id: true, jobId: true, context: true, inputFingerprint: true, status: true },
  });
  if (!pack || pack.status === 'FAILED') throw new InterviewPrepPackNotFoundError();

  const inputs = await buildPrepInputs({
    userId,
    jobId: pack.jobId,
    context: pack.context,
  });
  if (!inputs) {
    throw new InterviewPrepPackNotFoundError();
  }

  if (inputs.jobText.length < 40) {
    throw new Error('NO_JOB_DATA');
  }

  await logImportantInfo({
    event: 'interview_pack_refresh_started',
    userId,
    jobId: pack.jobId,
    route,
    context: { packId },
  });

  const idempotencyKey = `interview-prep-refresh:${packId}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    await logImportantInfo({
      event: 'interview_prep_admin_bypass',
      userId,
      route,
      context: { packId, operation: 'refresh' },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, INTERVIEW_PREP_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'interview_usage_denied',
          userId,
          route,
          context: { feature: INTERVIEW_PREP_FEATURE, limit: error.limit, used: error.used, packId, operation: 'refresh' },
        });
      }
      throw error;
    }
  }

  let provider: InterviewPrepAiProvider;
  try {
    provider = resolveInterviewPrepAiProvider();
  } catch (error) {
    await logImportantError({
      event: 'interview_pack_refresh_failed',
      userId,
      route,
      error,
      context: { packId, code: 'AI_NOT_CONFIGURED' },
    });
    throw error;
  }

  let verifiedPack: ReturnType<typeof verifyPack>;
  try {
    const modelPack = await provider.generatePack({
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
      context: pack.context,
      maxQuestions: INTERVIEW_PREP_MAX_QUESTIONS,
    });

    const profileEvidence: ProfileEvidence = {
      projectNames: inputs.projectNames,
      experienceTitles: inputs.profile.experienceTitles,
      skillNames: inputs.profile.skillNames,
    };

    verifiedPack = verifyPack({
      pack: modelPack,
      sources: { jobText: inputs.jobText, profileText: inputs.profile.contextText },
      profile: profileEvidence,
    });
  } catch (error) {
    await logImportantError({
      event: 'interview_pack_refresh_failed',
      userId,
      route,
      error,
      context: { packId, code: error instanceof InterviewPrepAiError ? error.code : 'AI_UNAVAILABLE' },
    });
    throw error;
  }

  const maxVersion = await prisma.interviewQuestion.aggregate({
    where: { packId },
    _max: { version: true },
  });
  const nextVersion = (maxVersion._max.version ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.interviewQuestion.updateMany({
      where: { packId, isActive: true },
      data: { isActive: false },
    });

    await tx.interviewQuestion.createMany({
      data: verifiedPack.questions.map((question, ordinal) => ({
        packId,
        version: nextVersion,
        ordinal,
        category: question.category,
        difficulty: question.difficulty,
        competency: question.competency,
        question: question.question,
        whyMatters: question.whyMatters,
        relatedRequirement: question.relatedRequirement,
        relevantExperience: question.relevantExperience,
        prepNotes: question.prepNotes,
        answerStructure: question.answerStructure as AnswerStructure | null,
        followUpQuestionIds: question.followUpQuestions,
        sourceType: 'GENERATED',
        sourceEvidence: question.sourceEvidence,
        isActive: true,
      })),
    });

    return tx.interviewPrepPack.update({
      where: { id: packId },
      data: {
        title: verifiedPack.title || 'Interview preparation pack',
        preparationGuidance: verifiedPack.preparationGuidance ?? null,
        limitations: verifiedPack.limitations,
        questionCount: verifiedPack.questions.length,
        updatedAt: new Date(),
      },
    });
  });

  await logImportantInfo({
    event: 'interview_pack_refreshed',
    userId,
    jobId: pack.jobId,
    route,
    context: { packId, questions: verifiedPack.questions.length, version: nextVersion, creditsConsumed },
  });

  const packWithQuestions = await getPackWithQuestions({ userId, packId });
  if (!packWithQuestions) {
    throw new InterviewPrepPackNotFoundError();
  }

  return { pack: packWithQuestions, data: packWithQuestions.data, creditsConsumed };
}

