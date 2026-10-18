/**
 * Job Intelligence orchestration.
 *
 * This is the only module allowed to start a paid AI operation. It runs the
 * same checks in the same order for every request, and every one of them
 * happens BEFORE we spend money:
 *
 *   1. authenticate            (the caller passes a session-derived userId)
 *   2. check the entitlement   (subscriptions.ts, timestamp-derived)
 *   3. load the user's profile (profile-context.ts) and preferences
 *   4. resolve the job         (ownership-scoped; a soft-deleted job is absent)
 *   5. compute deterministic   (score, tier, dimensions, fingerprint)
 *   6. duplicate suppression   (one row per input fingerprint is the lock)
 *   7. run the analysis        (no database lock is held while we wait)
 *   8. record the outcome      (usage already reserved; status now updated)
 *
 * No external call ever happens inside a database transaction.
 */

import { prisma } from '@/lib/prisma';
import { getUserPreferences } from '@/lib/db-helpers';
import { hasPrismaUniqueViolation } from '@/lib/db-helpers';
import { PlanRequiredError, requireEntitlement, type Entitlement } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError, consumeUsage } from '@/lib/billing/usage';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import {
  JobIntelligenceAiError,
  resolveJobIntelligenceAiProvider,
  type JobIntelligenceAiProvider,
} from './ai-client';
import { buildDeterministicInputs, type DeterministicInputs } from './deterministic';
import { buildProfileContext, type ProfileContext } from './profile-context';
import { buildDeterministicBlock } from './prompt';
import { verifyJobAnalysis } from './verify';
import { JOB_INTELLIGENCE_PROCESSING_STALE_MS } from './limits';
import {
  ANALYSIS_ERROR_MESSAGES,
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisErrorCode,
  type JobIntelligenceResult,
} from './schema';

/**
 * Feature key and metered capability.
 *
 * `AI_JOB_ANALYSIS` already existed in the monetization registry as a defined
 * but unreleased Pro capability. This release ships it rather than inventing a
 * new key, which is why there is no new plan, limit or usage table.
 */
export const JOB_INTELLIGENCE_FEATURE = 'AI_JOB_ANALYSIS' as const;

export class JobNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Job not found.');
    this.name = 'JobNotFoundError';
  }
}

export class DuplicateAnalysisInFlightError extends Error {
  readonly code = 'DUPLICATE_REQUEST';
  readonly status = 409;

  constructor() {
    super('An analysis of this job is already running.');
    this.name = 'DuplicateAnalysisInFlightError';
  }
}

export type AnalysisSummary = {
  id: string;
  jobId: string;
  status: string;
  schemaVersion: number;
  errorCode: AnalysisErrorCode | null;
  createdAt: Date;
  completedAt: Date | null;
  model: string | null;
  /** True when a completed result exists for the current inputs. */
  isFresh: boolean;
};

export type RunAnalysisResult =
  | { outcome: 'REUSED'; analysis: AnalysisSummary; data: JobIntelligenceResult }
  | {
      outcome: 'COMPLETED';
      analysis: AnalysisSummary;
      data: JobIntelligenceResult;
      creditsConsumed: number;
    }
  | {
      outcome: 'FAILED';
      analysis: AnalysisSummary | null;
      code: AnalysisErrorCode;
      message: string;
      retryable: boolean;
    };

export type RunAnalysisOptions = {
  /** Server-derived. Never read from a request body. */
  userId: string;
  jobId: string;
  /**
   * The user explicitly asked for a fresh analysis even though a completed
   * result exists for these exact inputs. Charged as a new operation.
   */
  force?: boolean;
  route: string;
  /** Injected by tests; production always resolves the configured provider. */
  provider?: JobIntelligenceAiProvider;
};

// ─── Row helpers ───────────────────────────────────────────────────────────

type AnalysisRow = {
  id: string;
  jobId: string;
  userId: string;
  status: string;
  schemaVersion: number;
  inputFingerprint: string;
  data: unknown;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  model: string | null;
  provider: string | null;
};

function findAnalysis(params: {
  userId: string;
  jobId: string;
  inputFingerprint: string;
}): Promise<AnalysisRow | null> {
  return prisma.jobIntelligenceAnalysis.findUnique({
    where: {
      userId_jobId_inputFingerprint_schemaVersion: {
        userId: params.userId,
        jobId: params.jobId,
        inputFingerprint: params.inputFingerprint,
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
      },
    },
  });
}

function toSummary(row: AnalysisRow, isFresh: boolean): AnalysisSummary {
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    schemaVersion: row.schemaVersion,
    errorCode: (row.errorCode as AnalysisErrorCode | null) ?? null,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    model: row.model,
    isFresh,
  };
}

function isStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > JOB_INTELLIGENCE_PROCESSING_STALE_MS;
}

/**
 * Claim the analysis row for this exact input set.
 *
 * The unique index is the lock. A second request either loses the insert race —
 * and then re-reads and sees a run already in progress — or takes over a row
 * that has been stale long enough that its function must have died.
 */
async function claimAnalysisRow(params: {
  userId: string;
  jobId: string;
  inputFingerprint: string;
}): Promise<{ row: AnalysisRow; claimed: boolean }> {
  const existing = await findAnalysis(params);

  if (!existing) {
    try {
      const created = await prisma.jobIntelligenceAnalysis.create({
        data: {
          userId: params.userId,
          jobId: params.jobId,
          inputFingerprint: params.inputFingerprint,
          schemaVersion: ANALYSIS_SCHEMA_VERSION,
          status: 'PROCESSING',
        },
      });
      return { row: created, claimed: true };
    } catch (error) {
      if (!hasPrismaUniqueViolation(error)) throw error;
      const raced = await findAnalysis(params);
      if (!raced) throw error;
      return { row: raced, claimed: false };
    }
  }

  if (existing.status === 'PROCESSING' && !isStale(existing.updatedAt)) {
    return { row: existing, claimed: false };
  }

  // A COMPLETED row is NOT re-claimed here. Overwriting it to PROCESSING would
  // destroy the very result the caller is about to reuse. Callers check for a
  // reusable result before claiming.
  const updated = await prisma.jobIntelligenceAnalysis.update({
    where: { id: existing.id },
    data: { status: 'PROCESSING', errorCode: null, completedAt: null },
  });
  return { row: updated, claimed: true };
}

// ─── The run ───────────────────────────────────────────────────────────────

/**
 * Run an analysis for one job against one user's profile.
 *
 * Expected to throw `PlanRequiredError` (403) or `UsageLimitExceededError`
 * (403) before touching a provider. `JobIntelligenceAiError` is captured into
 * the result instead, so a provider outage is a recoverable state the UI can
 * offer a retry for rather than a 500.
 */
export async function runJobAnalysis(
  options: RunAnalysisOptions,
): Promise<RunAnalysisResult> {
  const { userId, jobId, route } = options;

  // 2. Entitlement. Throws PlanRequiredError, which the route maps to 403.
  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, JOB_INTELLIGENCE_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'job_analysis_denied',
      userId,
      jobId,
      route,
      context: { feature: JOB_INTELLIGENCE_FEATURE },
    });
    throw error;
  }

  // 3. Profile context and preferences. These are two independent reads, so
  //    they run together; the job itself is resolved immediately after,
  //    because the fingerprint depends on both.
  const [preferences, profile] = await Promise.all([
    getUserPreferences(userId),
    buildProfileContext({ userId }),
  ]);

  // 4. The user's own job. A job id belonging to someone else raises
  //    JobNotFoundError — a 404 identical in shape to a job that genuinely does
  //    not exist. The response must not confirm that another user's lead exists.
  const resolved = await buildDeterministicInputs({ userId, jobId, preferences, profile });
  if (!resolved) throw new JobNotFoundError();

  await logImportantInfo({
    event: 'job_analysis_started',
    userId,
    jobId,
    route,
    context: {
      force: options.force === true,
      fitScore: resolved.fitScore,
      fitTier: resolved.fitTier,
      profileCompleteness: profile.completeness,
      dataCompleteness: resolved.dataCompleteness,
    },
  });

  // Reuse is checked BEFORE the row is claimed. Claiming flips the row to
  // PROCESSING, so checking afterwards would destroy the very result being
  // reused.
  if (!options.force) {
    const reusable = await findAnalysis({
      userId,
      jobId,
      inputFingerprint: resolved.inputFingerprint,
    });
    if (reusable?.status === 'COMPLETED' && reusable.data) {
      await logImportantInfo({
        event: 'job_analysis_reused',
        userId,
        jobId,
        route,
        context: { analysisId: reusable.id },
      });
      return {
        outcome: 'REUSED',
        analysis: toSummary(reusable, true),
        data: reusable.data as JobIntelligenceResult,
      };
    }
  }

  const { row, claimed } = await claimAnalysisRow({
    userId,
    jobId,
    inputFingerprint: resolved.inputFingerprint,
  });

  // Another request for this exact input set is mid-flight. Refusing is what
  // prevents two identical expensive calls racing each other.
  if (!claimed && row.status === 'PROCESSING') {
    throw new DuplicateAnalysisInFlightError();
  }

  // 5. Usage. Reserved immediately before the provider call, under the existing
  // advisory lock, so parallel requests serialise and a retry of this same
  // input set is not charged twice.
  const idempotencyKey = options.force
    ? `job-analysis:${row.id}:forced`
    : `job-analysis:${row.id}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    // Admins hold the platform's credentials, not a customer subscription, so
    // their usage is recorded as zero — the same exemption the resume feature
    // applies, kept consistent rather than special-cased here.
    await logImportantInfo({
      event: 'job_analysis_admin_bypass',
      userId,
      jobId,
      route,
      context: { analysisId: row.id },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, JOB_INTELLIGENCE_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'job_analysis_usage_denied',
          userId,
          jobId,
          route,
          context: { feature: JOB_INTELLIGENCE_FEATURE, limit: error.limit, used: error.used },
        });
        // The row was claimed and is now PROCESSING with nothing behind it.
        // Release it so the user can retry without being blocked by a phantom
        // in-flight run.
        await releaseClaim(row.id);
      }
      throw error;
    }
  }

  // 6. Provider call. No transaction is open and no row lock is held.
  let provider: JobIntelligenceAiProvider;
  try {
    provider = options.provider ?? resolveJobIntelligenceAiProvider();
  } catch (error) {
    await markFailed(row.id, error);
    return failureFor(row.id, error);
  }

  let data: JobIntelligenceResult;
  try {
    const model = await provider.analyse({
      deterministicBlock: buildDeterministicInputsForPrompt(resolved),
      careerProfileBlock: profile.contextText,
      jobText: resolved.jobText,
    });

    // Re-verified before anything is stored: excerpts are re-checked against
    // the posting, capability claims against the profile, and the deterministic
    // dimensions and category are re-applied. This is what makes the stored
    // result safe to show a user as evidence-backed.
    data = verifyJobAnalysis({
      model,
      inputs: resolved,
      sources: { jobText: resolved.jobText, profileText: profile.contextText },
      provider: provider.name,
      modelName: provider.model,
      generatedAt: new Date(),
    });
  } catch (error) {
    await markFailed(row.id, error);
    await logImportantError({
      event: 'job_analysis_failed',
      userId,
      jobId,
      route,
      error,
      context: { analysisId: row.id, code: analysisCode(error) },
    });
    return failureFor(row.id, error);
  }

  // 7. Record the outcome.
  const completed = await prisma.jobIntelligenceAnalysis.update({
    where: { id: row.id },
    data: {
      status: 'COMPLETED',
      data: data as unknown as object,
      errorCode: null,
      completedAt: new Date(),
      provider: provider.name,
      model: provider.model,
      jobTextTruncated: resolved.wasTruncated,
    },
  });

  await logImportantInfo({
    event: 'job_analysis_succeeded',
    userId,
    jobId,
    route,
    context: {
      analysisId: completed.id,
      model: provider.model,
      category: data.overallCategory,
      truncated: resolved.wasTruncated,
      creditsConsumed,
    },
  });

  return {
    outcome: 'COMPLETED',
    analysis: toSummary(completed, true),
    data,
    creditsConsumed,
  };
}

/** The deterministic block, formatted for the prompt. */
export function buildDeterministicInputsForPrompt(inputs: DeterministicInputs): string {
  return buildDeterministicBlock({
    jobTitle: inputs.job.title,
    jobCompany: inputs.job.company,
    fitScore: inputs.fitScore,
    fitTier: inputs.fitTier,
    blockedBy: inputs.blockedBy,
    titleMatch: inputs.titleMatch,
    titleRelationship: inputs.titleRelationship.relationship,
    workArrangement: inputs.workArrangement.arrangement,
    remoteCompatibility: inputs.remoteCompatibility,
    locationCompatibility: inputs.locationCompatibility,
    timeZoneCompatibility: inputs.timeZoneCompatibility,
    eligibilityCompatibility: inputs.eligibilityCompatibility,
    compensation: inputs.compensation,
    hadJobDescription: inputs.hadJobDescription,
    dataCompleteness: inputs.dataCompleteness,
  });
}

/**
 * Put a claimed row back to FAILED so the next request can take it over.
 *
 * Without this, a usage rejection would leave a PROCESSING row that blocks the
 * user for the full stale window even though nothing is running.
 */
async function releaseClaim(analysisId: string): Promise<void> {
  await prisma.jobIntelligenceAnalysis
    .update({
      where: { id: analysisId },
      data: { status: 'FAILED', errorCode: 'AI_UNAVAILABLE', completedAt: new Date() },
    })
    .catch(() => undefined);
}

async function markFailed(analysisId: string, error: unknown): Promise<void> {
  await prisma.jobIntelligenceAnalysis
    .update({
      where: { id: analysisId },
      data: { status: 'FAILED', errorCode: analysisCode(error), completedAt: new Date() },
    })
    .catch(() => undefined);
}

function analysisCode(error: unknown): AnalysisErrorCode {
  if (error instanceof JobIntelligenceAiError) return error.code;
  return 'AI_UNAVAILABLE';
}

async function failureFor(analysisId: string, error: unknown): Promise<RunAnalysisResult> {
  const code = analysisCode(error);
  const row = await prisma.jobIntelligenceAnalysis
    .findUnique({ where: { id: analysisId } })
    .catch(() => null);

  return {
    outcome: 'FAILED',
    analysis: row ? toSummary(row, false) : null,
    code,
    message: ANALYSIS_ERROR_MESSAGES[code],
    // Taken from the error itself rather than recomputed here, so the value the
    // UI is told matches the value the provider boundary decided on.
    retryable: error instanceof JobIntelligenceAiError ? error.retryable : true,
  };
}

// ─── Reading ───────────────────────────────────────────────────────────────

/**
 * Load a completed analysis the caller owns.
 *
 * Ownership is part of the query, so another user's analysis is a 404 rather
 * than a 403 — the response must not confirm that it exists.
 */
export async function getAnalysisForJob(params: {
  userId: string;
  jobId: string;
}): Promise<{ analysis: AnalysisSummary; data: JobIntelligenceResult } | null> {
  const row = await prisma.jobIntelligenceAnalysis.findFirst({
    where: {
      userId: params.userId,
      jobId: params.jobId,
      status: 'COMPLETED',
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
    },
    orderBy: { completedAt: 'desc' },
  });

  if (!row || !row.data) return null;

  // Recomputed every read, so a result the user is looking at is labelled
  // stale the moment the job, profile or preferences change underneath it.
  const [preferences, profile] = await Promise.all([
    getUserPreferences(params.userId),
    buildProfileContext({ userId: params.userId }),
  ]);
  const current = await buildDeterministicInputs({
    userId: params.userId,
    jobId: params.jobId,
    preferences,
    profile,
  });
  const isFresh = Boolean(current && current.inputFingerprint === row.inputFingerprint);

  return { analysis: toSummary(row, isFresh), data: row.data as JobIntelligenceResult };
}

/**
 * Deterministic inputs for a job, without running an analysis.
 *
 * Used by the GET route so the workspace can show the existing score next to
 * the AI's explanation, and so the UI can tell the user when a cached analysis
 * no longer reflects their inputs.
 */
export async function getAnalysisContext(params: {
  userId: string;
  jobId: string;
}): Promise<{ inputs: DeterministicInputs; profile: ProfileContext } | null> {
  const [preferences, profile] = await Promise.all([
    getUserPreferences(params.userId),
    buildProfileContext({ userId: params.userId }),
  ]);
  const inputs = await buildDeterministicInputs({
    userId: params.userId,
    jobId: params.jobId,
    preferences,
    profile,
  });
  if (!inputs) return null;
  return { inputs, profile };
}

export { PlanRequiredError, JobIntelligenceAiError };