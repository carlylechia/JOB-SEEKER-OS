/**
 * Resume optimisation orchestration.
 *
 * This is the only module allowed to start a paid AI operation for the resume
 * builder. It runs the same checks in the same order as the two sibling
 * features, and every one of them happens BEFORE we spend money:
 *
 *   1. authenticate            (the caller passes a session-derived userId)
 *   2. check the entitlement   (subscriptions.ts, timestamp-derived)
 *   3. resolve the resume      (ownership-scoped; a soft-deleted row is absent)
 *   4. resolve the target job  (ownership-scoped; never the public catalogue)
 *   5. validate the operation  (there is a resume, there is a posting)
 *   6. compute deterministic   (fit facts, input fingerprint)
 *   7. duplicate suppression   (one row per input fingerprint is the lock)
 *   8. run the proposal        (no database lock is held while we wait)
 *   9. record the outcome      (usage already reserved; status now updated)
 *
 * No external call ever happens inside a database transaction.
 *
 * Applying accepted suggestions is deliberately NOT in this file's hot path for
 * the provider: `applyAcceptedOperations` never calls the model, never consumes
 * a credit, and re-resolves every operation against the live document first.
 */

import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getUserPreferences, hasPrismaUniqueViolation } from '@/lib/db-helpers';
import { requireEntitlement, type Entitlement } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError, consumeUsage } from '@/lib/billing/usage';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { calculateFitTier } from '@/lib/scoring';
import { buildProfileContext } from '@/lib/job-intelligence/profile-context';
import { buildDeterministicInputs } from '@/lib/job-intelligence/deterministic';
import {
  ResumeOptimizationAiError,
  resolveOptimizationAiProvider,
  type ResumeOptimizationAiProvider,
} from './ai-client';
import {
  OPTIMIZATION_MAX_PROFILE_CHARS,
  OPTIMIZATION_MAX_RESUME_CHARS,
  OPTIMIZATION_MIN_PROFILE_CHARS,
  OPTIMIZATION_MIN_RESUME_CHARS,
  OPTIMIZATION_PROCESSING_STALE_MS,
  JOB_INTELLIGENCE_MAX_JOB_CHARS,
  JOB_INTELLIGENCE_MIN_JOB_CHARS,
} from './limits';
import { buildDeterministicBlock } from './prompt';
import { findNewClaims, resumeContentToText, verifyProposal } from './verify';
import {
  OPTIMIZATION_ERROR_MESSAGES,
  OPTIMIZATION_SCHEMA_VERSION,
  type OptimizationErrorCode,
  type OptimizationResult,
} from './schema';
import {
  getResume,
  StructuredResumeNotFoundError,
  TargetJobNotFoundError,
  type StructuredResumeRecord,
} from '../documents';
import { resumeContentSchema, type ResumeContent } from '../schema';

/**
 * Feature key and metered capability.
 *
 * `RESUME_OPTIMIZATION` has existed in the entitlement registry since the
 * monetization launch as a defined but unreleased Pro capability. This release
 * ships it rather than inventing a new key, which is why there is no new plan,
 * no new limit and no new usage table.
 */
export const RESUME_OPTIMIZATION_FEATURE = 'RESUME_OPTIMIZATION' as const;

export class NoTargetJobError extends Error {
  readonly code = 'NO_JOB_DATA';
  readonly status = 404;

  constructor() {
    super('Choose a job to optimise this resume for first.');
    this.name = 'NoTargetJobError';
  }
}

export class DuplicateOptimizationInFlightError extends Error {
  readonly code = 'DUPLICATE_REQUEST';
  readonly status = 409;

  constructor() {
    super('Optimisation is already running for this resume and job.');
    this.name = 'DuplicateOptimizationInFlightError';
  }
}

export class OptimizationStaleError extends Error {
  readonly code = 'STALE_OPTIMIZATION';
  readonly status = 409;

  constructor() {
    super('Your resume or the job changed after these suggestions were made. Run it again to get fresh ones.');
    this.name = 'OptimizationStaleError';
  }
}

export class NoOperationsAcceptedError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;

  constructor() {
    super('Choose at least one suggestion to accept.');
    this.name = 'NoOperationsAcceptedError';
  }
}

/**
 * The user accepted a suggestion, edited it, and the edit introduced something
 * their resume does not support.
 *
 * Deliberately DISTINCT from `NoOperationsAcceptedError`. Telling somebody to
 * "choose at least one suggestion" when they chose one and then typed their own
 * version would send them looking in entirely the wrong place — and the thing
 * they actually need to know is that the figure they typed is the problem.
 */
export class EditedTextRejectedError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;

  constructor() {
    super(
      'Your edited text introduced something your resume does not support, so nothing was changed. Take the figure out, or add it to your resume first.',
    );
    this.name = 'EditedTextRejectedError';
  }
}

export class InformationGapNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('This question is no longer available. Run optimisation again.');
    this.name = 'InformationGapNotFoundError';
  }
}

export class RefinedAnswerRejectedError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;

  constructor() {
    super('The rewrite added a detail that was not in your answer. Nothing was changed; edit the answer or keep your own wording.');
    this.name = 'RefinedAnswerRejectedError';
  }
}

export type OptimizationSummary = {
  id: string;
  resumeId: string;
  jobId: string;
  status: string;
  schemaVersion: number;
  errorCode: OptimizationErrorCode | null;
  createdAt: Date;
  completedAt: Date | null;
  model: string | null;
  creditsConsumed: number;
  /** True while the result still reflects the current resume and job. */
  isFresh: boolean;
};

export type RunOptimizationResult =
  | { outcome: 'REUSED'; optimization: OptimizationSummary; data: OptimizationResult }
  | {
      outcome: 'COMPLETED';
      optimization: OptimizationSummary;
      data: OptimizationResult;
      creditsConsumed: number;
    }
  | {
      outcome: 'FAILED';
      optimization: OptimizationSummary | null;
      code: OptimizationErrorCode;
      message: string;
      retryable: boolean;
    };

export type RunOptimizationOptions = {
  /** Server-derived. Never read from a request body. */
  userId: string;
  resumeId: string;
  /** Server-derived from the stored `targetJobId`. Never from the body. */
  jobId?: string;
  force?: boolean;
  route: string;
  provider?: ResumeOptimizationAiProvider;
};

// ─── Row helpers ───────────────────────────────────────────────────────────

type OptimizationRow = {
  id: string;
  userId: string;
  resumeId: string;
  jobId: string;
  status: string;
  schemaVersion: number;
  inputFingerprint: string;
  baseRevision: number;
  data: unknown;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  creditsConsumed: number;
  model: string | null;
  provider: string | null;
  thinInputs: boolean;
};

function toSummary(row: OptimizationRow, isFresh: boolean): OptimizationSummary {
  return {
    id: row.id,
    resumeId: row.resumeId,
    jobId: row.jobId,
    status: row.status,
    schemaVersion: row.schemaVersion,
    errorCode: (row.errorCode as OptimizationErrorCode | null) ?? null,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    model: row.model,
    creditsConsumed: row.creditsConsumed,
    isFresh,
  };
}

function findOptimization(params: {
  userId: string;
  resumeId: string;
  jobId: string;
  inputFingerprint: string;
}): Promise<OptimizationRow | null> {
  return prisma.resumeOptimization.findUnique({
    where: {
      userId_resumeId_jobId_inputFingerprint_schemaVersion: {
        userId: params.userId,
        resumeId: params.resumeId,
        jobId: params.jobId,
        inputFingerprint: params.inputFingerprint,
        schemaVersion: OPTIMIZATION_SCHEMA_VERSION,
      },
    },
  });
}

/**
 * Claim the row for this exact input set.
 *
 * The unique index is the lock, for the same reason and with the same trade-off
 * as the sibling features: two identical requests cannot both reach the
 * provider, and a row left PROCESSING by a killed function is taken over once
 * it is old enough that nothing can still be running behind it.
 */
async function claimOptimizationRow(params: {
  userId: string;
  resumeId: string;
  jobId: string;
  inputFingerprint: string;
  baseRevision: number;
}): Promise<{ row: OptimizationRow; claimed: boolean }> {
  const existing = await findOptimization(params);

  if (!existing) {
    try {
      const created = await prisma.resumeOptimization.create({
        data: {
          userId: params.userId,
          resumeId: params.resumeId,
          jobId: params.jobId,
          inputFingerprint: params.inputFingerprint,
          schemaVersion: OPTIMIZATION_SCHEMA_VERSION,
          baseRevision: params.baseRevision,
          status: 'PROCESSING',
        },
      });
      return { row: created, claimed: true };
    } catch (error) {
      if (!hasPrismaUniqueViolation(error)) throw error;
      const raced = await findOptimization(params);
      if (!raced) throw error;
      return { row: raced, claimed: false };
    }
  }

  if (existing.status === 'PROCESSING' && !isStale(existing.updatedAt)) {
    return { row: existing, claimed: false };
  }

  const updated = await prisma.resumeOptimization.update({
    where: { id: existing.id },
    data: {
      status: 'PROCESSING',
      errorCode: null,
      completedAt: null,
      baseRevision: params.baseRevision,
    },
  });
  return { row: updated, claimed: true };
}

function isStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > OPTIMIZATION_PROCESSING_STALE_MS;
}

// ─── Input assembly ─────────────────────────────────────────────────────────

export type OptimizationInputs = {
  resume: StructuredResumeRecord;
  job: { id: string; title: string; company: string; jobDescription: string | null; updatedAt: Date };
  resumeText: string;
  resumeTruncated: boolean;
  profileText: string;
  hadConfirmedProfile: boolean;
  jobText: string;
  hadJobDescription: boolean;
  fitScore: number;
  fitTier: string;
  blockedBy: string[];
  inputFingerprint: string;
  thinInputs: boolean;
};

/**
 * Load and validate everything a run needs, or raise a domain error.
 *
 * Deterministic and free of side effects beyond reads, so both the run path and
 * the read path can call it and get identical fingerprints. That identity is
 * what makes the staleness check meaningful.
 */
export async function buildOptimizationInputs(params: {
  userId: string;
  resumeId: string;
  jobId?: string | null;
}): Promise<OptimizationInputs> {
  const resume = await getResume({ userId: params.userId, resumeId: params.resumeId });

  const jobId = params.jobId ?? resume.targetJobId;
  if (!jobId) throw new NoTargetJobError();

  // Ownership-scoped. Another user's job, or a soft-deleted one, is a 404
  // identical in shape to a job that does not exist.
  const jobRow = await prisma.jobLead.findFirst({
    where: { id: jobId, userId: params.userId, deletedAt: null },
    select: { id: true, title: true, company: true, jobDescription: true, updatedAt: true },
  });
  if (!jobRow) throw new TargetJobNotFoundError();

  const jobText = (jobRow.jobDescription ?? '').trim();
  const hadJobDescription = jobText.length > 0;

  const resumeText = resumeContentToText(resume.content);
  const resumeTruncated = resumeText.length > OPTIMIZATION_MAX_RESUME_CHARS;

  // The career profile context is reused verbatim from job intelligence rather
  // than rebuilt. One profile, one serialisation, one place that decides what
  // "the candidate's confirmed history" means.
  const profile = await buildProfileContext({ userId: params.userId });
  const hadConfirmedProfile = profile.confirmed;
  const profileText = profile.contextText.slice(0, OPTIMIZATION_MAX_PROFILE_CHARS);

  // Deterministic job facts, computed by the application and re-applied after
  // the model returns. The model cannot move a score.
  const preferences = await getUserPreferences(params.userId);
  const deterministic = await buildDeterministicInputs({
    userId: params.userId,
    jobId: jobRow.id,
    preferences,
    profile,
  });

  const fitScore = deterministic?.fitScore ?? 0;
  const fitTier = deterministic?.fitTier ?? 'C';
  const blockedBy = deterministic?.blockedBy ?? [];

  // "Thin" means we could not see enough to be specific. A missing posting, a
  // sparse resume and an unconfirmed career profile all reduce confidence in
  // the same direction, and the review UI says so rather than implying the
  // proposal had everything.
  const thinInputs =
    jobText.length < JOB_INTELLIGENCE_MIN_JOB_CHARS ||
    resumeText.length < OPTIMIZATION_MIN_RESUME_CHARS ||
    !hadConfirmedProfile ||
    profileText.length < OPTIMIZATION_MIN_PROFILE_CHARS;

  const inputFingerprint = fingerprintFor({
    resumeId: resume.id,
    revision: resume.revision,
    content: resumeText,
    jobId: jobRow.id,
    jobUpdatedAt: jobRow.updatedAt.toISOString(),
    jobText,
    profileText,
    fitScore,
    fitTier,
  });

  return {
    resume,
    job: jobRow,
    resumeText,
    resumeTruncated,
    profileText,
    hadConfirmedProfile,
    jobText,
    hadJobDescription,
    fitScore,
    fitTier,
    blockedBy,
    inputFingerprint,
    thinInputs,
  };
}

/**
 * Hash every input a proposal depends on.
 *
 * Normalised so that whitespace churn alone does not invalidate a result the
 * user is still happy with, while a real edit, a changed job, a changed profile
 * or a different score all do invalidate it.
 */
export function fingerprintFor(params: {
  resumeId: string;
  revision: number;
  content: string;
  jobId: string;
  jobUpdatedAt: string;
  jobText: string;
  profileText: string;
  fitScore: number;
  fitTier: string;
}): string {
  const normalise = (value: string) => value.replace(/\s+/g, ' ').trim();
  return createHash('sha256')
    .update(
      [
        `v${OPTIMIZATION_SCHEMA_VERSION}`,
        params.resumeId,
        String(params.revision),
        normalise(params.content),
        params.jobId,
        params.jobUpdatedAt,
        normalise(params.jobText),
        normalise(params.profileText),
        String(params.fitScore),
        params.fitTier,
      ].join(' '),
    )
    .digest('hex');
}

// ─── The run ────────────────────────────────────────────────────────────────

/**
 * Run (or reuse) a proposal for one resume against one job.
 *
 * Expected to throw `PlanRequiredError` / `UsageLimitExceededError` (both 403)
 * before touching a provider. `ResumeOptimizationAiError` is captured into the
 * result instead, so a provider outage is a recoverable state the UI can offer a
 * retry for rather than a 500.
 */
export async function runOptimization(
  options: RunOptimizationOptions,
): Promise<RunOptimizationResult> {
  const { userId, resumeId, route } = options;

  // 2. Entitlement.
  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, RESUME_OPTIMIZATION_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'resume_optimization_denied',
      userId,
      route,
      context: { feature: RESUME_OPTIMIZATION_FEATURE, resumeId },
    });
    throw error;
  }

  // 3–6. Resolve the resume, the job, the deterministic facts and the
  // fingerprint. Identical code on the read path, so "is this still fresh?" is a
  // comparison of two fingerprints rather than a heuristic.
  const inputs = await buildOptimizationInputs({ userId, resumeId, jobId: options.jobId });

  // Length, not presence. A job whose description field holds three words is
  // the same problem as one that has none, and paying for an analysis of
  // "x" would be spending the user's credit on nothing.
  if (inputs.jobText.length < JOB_INTELLIGENCE_MIN_JOB_CHARS) {
    await logImportantInfo({
      event: 'resume_optimization_failed',
      userId,
      route,
      context: { resumeId, jobId: inputs.job.id, code: 'NO_JOB_DATA' },
    });
    return {
      outcome: 'FAILED',
      optimization: null,
      code: 'NO_JOB_DATA',
      message: OPTIMIZATION_ERROR_MESSAGES.NO_JOB_DATA,
      retryable: false,
    };
  }

  if (inputs.resumeText.length < OPTIMIZATION_MIN_RESUME_CHARS) {
    await logImportantInfo({
      event: 'resume_optimization_failed',
      userId,
      route,
      context: { resumeId, jobId: inputs.job.id, code: 'NO_RESUME_CONTENT' },
    });
    return {
      outcome: 'FAILED',
      optimization: null,
      code: 'NO_RESUME_CONTENT',
      message: OPTIMIZATION_ERROR_MESSAGES.NO_RESUME_CONTENT,
      retryable: false,
    };
  }

  await logImportantInfo({
    event: 'resume_optimization_started',
    userId,
      route,
    context: {
      resumeId,
      jobId: inputs.job.id,
      force: options.force === true,
      revision: inputs.resume.revision,
      fitScore: inputs.fitScore,
      thinInputs: inputs.thinInputs,
    },
  });

  // 7. Reuse is checked BEFORE the row is claimed. Claiming flips the row to
  // PROCESSING, so checking afterwards would destroy the result being reused.
  if (!options.force) {
    const reusable = await findOptimization({
      userId,
      resumeId,
      jobId: inputs.job.id,
      inputFingerprint: inputs.inputFingerprint,
    });
    if (reusable?.status === 'COMPLETED' && reusable.data) {
      await logImportantInfo({
        event: 'resume_optimization_reused',
        userId,
        route,
        context: { resumeId, optimizationId: reusable.id },
      });
      return {
        outcome: 'REUSED',
        optimization: toSummary(reusable, true),
        data: reusable.data as OptimizationResult,
      };
    }
  }

  const { row, claimed } = await claimOptimizationRow({
    userId,
    resumeId,
    jobId: inputs.job.id,
    inputFingerprint: inputs.inputFingerprint,
    baseRevision: inputs.resume.revision,
  });

  if (!claimed && row.status === 'PROCESSING') {
    throw new DuplicateOptimizationInFlightError();
  }

  // 8. Usage, reserved immediately before the provider call under the existing
  // advisory lock, so parallel requests serialise and a retry of this exact
  // input set is not charged twice.
  const idempotencyKey = options.force
    ? `resume-optimize:${row.id}:forced`
    : `resume-optimize:${row.id}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    // Admins hold the platform's credentials, not a customer subscription, so
    // their usage is recorded as zero — the same exemption both sibling
    // features apply, kept consistent rather than special-cased here.
    await logImportantInfo({
      event: 'resume_optimization_admin_bypass',
      userId,
      route,
      context: { resumeId, optimizationId: row.id },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, RESUME_OPTIMIZATION_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'resume_optimization_usage_denied',
          userId,
          route,
          context: {
            feature: RESUME_OPTIMIZATION_FEATURE,
            limit: error.limit,
            used: error.used,
          },
        });
        // The row was claimed and is now PROCESSING with nothing behind it.
        // Release it so the user can retry without a phantom in-flight run.
        await releaseClaim(row.id);
      }
      throw error;
    }
  }

  // 9. Provider call. No transaction is open and no row lock is held.
  let provider: ResumeOptimizationAiProvider;
  try {
    provider = options.provider ?? resolveOptimizationAiProvider();
  } catch (error) {
    await markFailed(row.id, error);
    return failureFor(row.id, error);
  }

  let data: OptimizationResult;
  try {
    const model = await provider.propose({
      deterministicBlock: buildDeterministicBlock({
        resumeName: inputs.resume.name,
        jobTitle: inputs.job.title,
        jobCompany: inputs.job.company,
        fitScore: inputs.fitScore,
        fitTier: inputs.fitTier,
        fitBlockedBy: inputs.blockedBy,
        hasJobDescription: inputs.hadJobDescription,
        hasConfirmedProfile: inputs.hadConfirmedProfile,
        revision: inputs.resume.revision,
      }),
      careerProfileBlock: inputs.profileText,
      careerProfileBlockIncluded: inputs.hadConfirmedProfile,
      resumeText: inputs.resumeText.slice(0, OPTIMIZATION_MAX_RESUME_CHARS),
      jobText: inputs.jobText.slice(0, JOB_INTELLIGENCE_MAX_JOB_CHARS),
    });

    // Re-verified before anything is stored. This is where the anti-fabrication
    // rule becomes real: targets are resolved against the live document,
    // staleness is detected, evidence is re-checked verbatim, and any rewrite
    // that introduced an unsupported number, acronym or name is refused.
    data = verifyProposal({
      proposal: model,
      content: inputs.resume.content,
      corpus: {
        resumeText: inputs.resumeText,
        profileText: inputs.profileText,
        jobText: inputs.jobText,
        jobMetaText: `${inputs.job.title} ${inputs.job.company}`,
      },
      provider: provider.name,
      model: provider.model,
      baseRevision: inputs.resume.revision,
      inputFingerprint: inputs.inputFingerprint,
      generatedAt: new Date(),
      hadJobDescription: inputs.hadJobDescription,
      hadConfirmedProfile: inputs.hadConfirmedProfile,
      resumeTruncated: inputs.resumeTruncated,
      job: {
        id: inputs.job.id,
        title: inputs.job.title,
        company: inputs.job.company,
        fitScore: inputs.fitScore,
        fitTier: inputs.fitTier,
      },
    });
  } catch (error) {
    await markFailed(row.id, error);
    await logImportantError({
      event: 'resume_optimization_failed',
      userId,
      route,
      error,
      context: { resumeId, optimizationId: row.id, code: optimizationCode(error) },
    });
    return failureFor(row.id, error);
  }

  // 10. Record the outcome.
  const completed = await prisma.resumeOptimization.update({
    where: { id: row.id },
    data: {
      status: 'COMPLETED',
      data: data as unknown as object,
      errorCode: null,
      completedAt: new Date(),
      provider: provider.name,
      model: provider.model,
      creditsConsumed,
      thinInputs: inputs.thinInputs,
    },
  });

  await logImportantInfo({
    event: 'resume_optimization_succeeded',
    userId,
    route,
    context: {
      resumeId,
      jobId: inputs.job.id,
      optimizationId: completed.id,
      model: provider.model,
      proposed: data.meta.proposedCount,
      accepted: data.meta.acceptedCount,
      rejected: data.rejected.length,
      creditsConsumed,
    },
  });

  return {
    outcome: 'COMPLETED',
    optimization: toSummary(completed, true),
    data,
    creditsConsumed,
  };
}

async function releaseClaim(optimizationId: string): Promise<void> {
  await prisma.resumeOptimization
    .update({
      where: { id: optimizationId },
      data: { status: 'FAILED', errorCode: 'AI_UNAVAILABLE', completedAt: new Date() },
    })
    .catch(() => undefined);
}

async function markFailed(optimizationId: string, error: unknown): Promise<void> {
  await prisma.resumeOptimization
    .update({
      where: { id: optimizationId },
      data: { status: 'FAILED', errorCode: optimizationCode(error), completedAt: new Date() },
    })
    .catch(() => undefined);
}

function optimizationCode(error: unknown): OptimizationErrorCode {
  if (error instanceof ResumeOptimizationAiError) return error.code;
  return 'AI_UNAVAILABLE';
}

async function failureFor(
  optimizationId: string,
  error: unknown,
): Promise<RunOptimizationResult> {
  const code = optimizationCode(error);
  const row = await prisma.resumeOptimization
    .findUnique({ where: { id: optimizationId } })
    .catch(() => null);

  return {
    outcome: 'FAILED',
    optimization: row ? toSummary(row, false) : null,
    code,
    message: OPTIMIZATION_ERROR_MESSAGES[code],
    retryable: error instanceof ResumeOptimizationAiError ? error.retryable : true,
  };
}

// ─── Reading ────────────────────────────────────────────────────────────────

/**
 * Load a completed proposal the caller owns, together with its freshness.
 *
 * Ownership is part of the query, so another user's proposal is a 404 rather
 * than a 403 — the response must not confirm that it exists.
 */
export async function getOptimizationForResume(params: {
  userId: string;
  resumeId: string;
  optimizationId?: string;
}): Promise<{
  optimization: OptimizationSummary;
  data: OptimizationResult;
  /** Why the result is stale, in words the review UI can show. */
  staleReasons: string[];
}> {
  const row = params.optimizationId
    ? await prisma.resumeOptimization.findFirst({
        where: { id: params.optimizationId, userId: params.userId, resumeId: params.resumeId },
      })
    : await prisma.resumeOptimization.findFirst({
        where: { userId: params.userId, resumeId: params.resumeId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
      });

  if (!row || row.status !== 'COMPLETED' || !row.data) {
    throw new StructuredResumeNotFoundError();
  }

  const staleReasons = await describeStaleness({ userId: params.userId, row });

  return {
    optimization: toSummary(row, staleReasons.length === 0),
    data: row.data as OptimizationResult,
    staleReasons,
  };
}

/** Refine one candidate-authored answer; the answer is never written automatically. */
export async function refineInformationGapAnswer(params: {
  userId: string;
  resumeId: string;
  optimizationId: string;
  question: string;
  why: string;
  answer: string;
  route: string;
  provider?: ResumeOptimizationAiProvider;
}): Promise<{ refinedAnswer: string; creditsConsumed: number }> {
  const stored = await getOptimizationForResume({
    userId: params.userId,
    resumeId: params.resumeId,
    optimizationId: params.optimizationId,
  });
  if (!stored.optimization.isFresh) throw new OptimizationStaleError();

  const gap = stored.data.informationGaps.find(
    (item) => item.question === params.question && item.why === params.why,
  );
  if (!gap) throw new InformationGapNotFoundError();

  const entitlements = await requireEntitlement(params.userId, RESUME_OPTIMIZATION_FEATURE);
  let creditsConsumed = 0;
  if (!entitlements.isAdmin) {
    const usage = await consumeUsage(params.userId, RESUME_OPTIMIZATION_FEATURE, 1, {
      limit: entitlements.limits.aiCredits,
      idempotencyKey: `resume-gap-answer:${randomUUID()}`,
    });
    creditsConsumed = usage.consumed;
  }

  const provider = params.provider ?? resolveOptimizationAiProvider();
  if (!provider.refineAnswer) {
    throw new ResumeOptimizationAiError('AI_UNAVAILABLE', false);
  }
  const refinedAnswer = (await provider.refineAnswer({
    question: gap.question,
    why: gap.why,
    answer: params.answer,
  })).trim();
  if (!refinedAnswer) throw new ResumeOptimizationAiError('AI_EMPTY_RESPONSE', true);

  const violations = findNewClaims(refinedAnswer, {
    resumeText: params.answer,
    profileText: '',
    jobText: '',
    jobMetaText: '',
  });
  if (violations.length > 0) throw new RefinedAnswerRejectedError();

  await logImportantInfo({
    event: 'resume_information_gap_answer_refined',
    userId: params.userId,
    route: params.route,
    context: { resumeId: params.resumeId, optimizationId: params.optimizationId, creditsConsumed },
  });
  return { refinedAnswer, creditsConsumed };
}

/**
 * Explain, in the user's terms, why a stored proposal no longer matches.
 *
 * Recomputed on every read rather than cached, so a proposal is labelled stale
 * the moment the resume or the job moves underneath it. An empty array means it
 * is still good to apply.
 */
export async function describeStaleness(params: {
  userId: string;
  row: OptimizationRow;
}): Promise<string[]> {
  const reasons: string[] = [];

  let current: OptimizationInputs | null = null;
  try {
    current = await buildOptimizationInputs({
      userId: params.userId,
      resumeId: params.row.resumeId,
      jobId: params.row.jobId,
    });
  } catch {
    // The resume or job is gone. That is itself the staleness.
    return ['The resume or job this was created from is no longer available.'];
  }

  if (current.inputFingerprint !== params.row.inputFingerprint) {
    if (current.resume.revision !== params.row.baseRevision) {
      reasons.push('You have edited this resume since these suggestions were made.');
    }
    if (reasons.length === 0) {
      // The resume text is identical but the fingerprint moved, so the change is
      // in the job, the career profile or the computed fit. One honest sentence
      // beats guessing which, and it tells the user the same thing: run it again.
      reasons.push('The job or your career profile has changed since these suggestions were made.');
    }
  }

  return reasons;
}

// ─── Applying accepted operations ───────────────────────────────────────────

export type ApplyAcceptedInput = {
  userId: string;
  resumeId: string;
  optimizationId: string;
  /** Operations the user accepted. Order is irrelevant; the server re-orders. */
  acceptedOperationIds: string[];
  /**
   * Optional user edits to a suggestion before accepting it.
   *
   * Re-verified with exactly the same anti-fabrication pass as the model's own
   * text, so "edit before accepting" is not a way around the truthfulness rule.
   */
  editedText?: Record<string, string>;
  expectedRevision: number;
};

export type ApplyAcceptedResult = {
  resume: StructuredResumeRecord;
  appliedCount: number;
  /** Operations that could not be applied, with the reason. */
  skipped: Array<{ id: string; reason: string }>;
};

/**
 * Apply accepted suggestions to ONE resume, atomically.
 *
 * The rules this exists to enforce:
 *
 *  - Only the resume the proposal was generated for is written. There is no
 *    "apply to another resume" parameter, so a stale result can never land on a
 *    different document.
 *  - Every operation is re-resolved against the live content first. The
 *    revision check and the write are one conditional update, so a save that
 *    lands while the user is reading the review cannot be silently overwritten.
 *  - No provider call and no AI credit. Accepting a suggestion is the user
 *    finishing a job the model already did.
 *  - All-or-nothing. If one operation cannot be applied safely the transaction
 *    still commits the rest and reports which were skipped, rather than writing
 *    a half-applied document that matches neither the review screen nor the
 *    original.
 */
export async function applyAcceptedOperations(
  input: ApplyAcceptedInput,
): Promise<ApplyAcceptedResult> {
  if (input.acceptedOperationIds.length === 0) throw new NoOperationsAcceptedError();

  const row = await prisma.resumeOptimization.findFirst({
    where: { id: input.optimizationId, userId: input.userId, resumeId: input.resumeId },
  });
  if (!row || row.status !== 'COMPLETED' || !row.data) {
    throw new StructuredResumeNotFoundError();
  }

  // Staleness is refused outright rather than warned about. Applying advice
  // generated against a different version of the document is exactly the failure
  // this whole design exists to prevent.
  const staleReasons = await describeStaleness({ userId: input.userId, row });
  if (staleReasons.length > 0) throw new OptimizationStaleError();

  const resume = await getResume({ userId: input.userId, resumeId: input.resumeId });
  if (resume.revision !== input.expectedRevision) {
    throw new OptimizationStaleError();
  }

  const stored = row.data as OptimizationResult;
  const accepted = new Set(input.acceptedOperationIds);
  const chosen = stored.operations.filter((operation) => accepted.has(operation.id));

  const skipped: Array<{ id: string; reason: string }> = [];
  const known = new Set(stored.operations.map((operation) => operation.id));
  for (const id of accepted) {
    if (!known.has(id)) skipped.push({ id, reason: 'This suggestion is not part of these results.' });
  }

  // A fresh verification pass over the ACCEPTED set only, using the same
  // resolver the run used. This is what makes a user-edited suggestion safe:
  // editing the text does not skip the claim check.
  const recheck = verifyProposal({
    proposal: {
      schemaVersion: OPTIMIZATION_SCHEMA_VERSION,
      summary: stored.summary,
      operations: chosen.map((operation) => ({
        kind: operation.kind,
        target: {
          section: operation.section,
          entryIndex: operation.entryIndex,
          field: operation.field,
          bulletIndex: operation.bulletIndex,
        },
        originalText: operation.originalText,
        proposedText: input.editedText?.[operation.id] ?? operation.proposedText,
        reason: operation.reason,
        targetRequirement: operation.targetRequirement,
        evidence: operation.evidence,
        preservesOriginalClaim: true,
        confidence: operation.confidence,
        warnings: operation.warnings,
        moveTo: operation.moveTo,
      })),
      informationGaps: stored.informationGaps,
      warnings: [],
    },
    content: resume.content,
    corpus: {
      resumeText: resumeContentToText(resume.content),
      profileText: '',
      jobText: '',
      jobMetaText: `${stored.job.title} ${stored.job.company}`,
    },
    provider: stored.meta.provider,
    model: stored.meta.model,
    baseRevision: resume.revision,
    inputFingerprint: row.inputFingerprint,
    generatedAt: new Date(stored.meta.generatedAt),
    hadJobDescription: stored.meta.hadJobDescription,
    hadConfirmedProfile: stored.meta.hadConfirmedProfile,
    resumeTruncated: false,
    job: stored.job,
  });

  // Anything the re-check refused is reported, not applied.
  const recheckIds = new Set(recheck.operations.map((operation) => operation.id));
  let editedTextRejections = 0;
  for (const operation of chosen) {
    if (recheckIds.has(operation.id)) continue;
    editedTextRejections += 1;
    skipped.push({
      id: operation.id,
      reason: 'The edited text introduced something your resume does not support.',
    });
  }
  const applicable = recheck.operations;

  if (applicable.length === 0) {
    // The user DID select something; if the only reason nothing applied is that
    // their own edit introduced an unsupported claim, say so.
    if (editedTextRejections > 0) throw new EditedTextRejectedError();
    throw new NoOperationsAcceptedError();
  }

  const nextContent = applyToContent(resume.content, applicable);
  const validated = validateContent(nextContent);

  await prisma.$transaction(async (tx) => {
    const result = await tx.structuredResume.updateMany({
      where: {
        id: resume.id,
        userId: input.userId,
        revision: input.expectedRevision,
      },
      data: { content: validated as unknown as object, revision: { increment: 1 } },
    });
    if (result.count === 0) throw new OptimizationStaleError();
  });

  await logImportantInfo({
    event: 'resume_optimization_applied',
    userId: input.userId,
    route: `/api/resumes/${resume.id}/optimization/apply`,
    context: {
      resumeId: resume.id,
      jobId: row.jobId,
      optimizationId: row.id,
      applied: applicable.length,
      skipped: skipped.length,
    },
  });

  return {
    resume: await getResume({ userId: input.userId, resumeId: resume.id }),
    appliedCount: applicable.length,
    skipped,
  };
}

/**
 * Apply verified operations to a copy of the document.
 *
 * Structural edits are collected first and committed last, so that indices
 * computed against the ORIGINAL document stay valid while earlier edits are
 * being applied. Writing bullets as they are walked without re-resolving each
 * index is the bug that turns "rewrite bullet 3" into "rewrite the wrong bullet"
 * as soon as bullet 1 was also accepted.
 */
export function applyToContent(
  content: ResumeContent,
  operations: Array<{
    id: string;
    kind: string;
    section: string;
    entryIndex: number | null;
    field: string | null;
    bulletIndex: number | null;
    moveTo: number | null;
    proposedText: string;
  }>,
): ResumeContent {
  const next = structuredClone(content);

  const summaryOps = operations.filter((op) => op.kind === 'REPLACE_SUMMARY');
  if (summaryOps.length > 0) {
    next.summary = summaryOps[summaryOps.length - 1].proposedText.trim() || null;
  }

  const headlineOps = operations.filter((op) => op.kind === 'REWRITE_HEADLINE');
  if (headlineOps.length > 0) {
    next.basics.headline = headlineOps[headlineOps.length - 1].proposedText.trim() || null;
  }

  const bulletOps = operations.filter(
    (op) => op.kind === 'REWRITE_BULLET' || op.kind === 'REMOVE_BULLET',
  );

  // Group by target list, then apply per list from highest index to lowest so a
  // removal or rewrite cannot shift the indices of the ones still to come.
  const byList = new Map<string, typeof bulletOps>();
  for (const operation of bulletOps) {
    const key = `${operation.section}:${operation.entryIndex}:${operation.field}`;
    const bucket = byList.get(key);
    if (bucket) bucket.push(operation);
    else byList.set(key, [operation]);
  }

  for (const [key, group] of byList) {
    const [section, entryIndexRaw, field] = key.split(':');
    const entryIndex = Number(entryIndexRaw);
    if (!field) continue;

    const entry =
      section === 'EXPERIENCE'
        ? next.experiences[entryIndex]
        : section === 'PROJECTS'
          ? next.projects[entryIndex]
          : undefined;
    if (!entry) continue;

    const list = (entry as unknown as Record<string, unknown>)[field];
    if (!Array.isArray(list)) continue;
    const working = [...(list as string[])];

    const ordered = [...group].sort(
      (a, b) => (b.bulletIndex ?? 0) - (a.bulletIndex ?? 0),
    );
    for (const operation of ordered) {
      const index = operation.bulletIndex;
      if (index === null || index < 0 || index >= working.length) continue;
      if (operation.kind === 'REMOVE_BULLET') working.splice(index, 1);
      else working[index] = operation.proposedText;
    }

    (entry as unknown as Record<string, unknown>)[field] = working;
  }

  // Reorders are applied last, against the settled lists.
  const skillsOrder = operations.find((op) => op.kind === 'REORDER_SKILLS');
  if (skillsOrder) {
    const wanted = skillsOrder.proposedText
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const remaining = [...next.skills];
    next.skills = wanted
      .map((name) => {
        const key = name.toLowerCase();
        const index = remaining.findIndex((skill) => skill.name.toLowerCase() === key);
        return index >= 0 ? (remaining.splice(index, 1)[0] as (typeof next.skills)[number]) : null;
      })
      .filter((skill): skill is (typeof next.skills)[number] => skill !== null);
  }

  const experienceOrder = operations.find((op) => op.kind === 'REORDER_EXPERIENCE');
  if (experienceOrder) {
    const wanted = experienceOrder.proposedText
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const remaining = [...next.experiences];
    next.experiences = wanted
      .map((label) => {
        const key = label.toLowerCase();
        const index = remaining.findIndex(
          (entry) =>
            (entry.jobTitle ?? '').toLowerCase() === key ||
            (entry.company ?? '').toLowerCase() === key,
        );
        return index >= 0 ? (remaining.splice(index, 1)[0] as (typeof next.experiences)[number]) : null;
      })
      .filter((entry): entry is (typeof next.experiences)[number] => entry !== null);
  }

  return next;
}

/**
 * Re-validate after editing.
 *
 * Applying a suggestion must not be a way to get an invalid document past the
 * schema: every accepted text still goes through the same limits, date rules
 * and URL checks as a manual edit.
 */
function validateContent(content: ResumeContent): ResumeContent {
  return resumeContentSchema.parse(content);
}

export { ResumeOptimizationAiError };
