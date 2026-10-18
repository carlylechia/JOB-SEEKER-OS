/**
 * Resume Intelligence orchestration.
 *
 * This is the only module allowed to start a paid AI operation. It runs the
 * same eight checks in the same order for every request, and every one of them
 * happens BEFORE we spend money:
 *
 *   1. authenticate            (the caller passes a session-derived userId)
 *   2. verify resume ownership (documents.ts loads by { id, userId })
 *   3. check the entitlement   (subscriptions.ts, timestamp-derived)
 *   4. validate the operation  (document exists, text is extractable)
 *   5. rate and usage limits   (route applies the burst limit; consumeUsage
 *                               applies the monthly credit)
 *   6. duplicate suppression   (one row per document version does the locking)
 *   7. run the extraction      (no database lock is held while we wait)
 *   8. record the outcome      (usage already recorded; status now updated)
 *
 * No external call ever happens inside a database transaction.
 */

import { prisma } from '@/lib/prisma';
import {
  PlanRequiredError,
  requireEntitlement,
  type Entitlement,
} from '@/lib/billing/subscriptions';
import { UsageLimitExceededError, consumeUsage } from '@/lib/billing/usage';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { hasPrismaUniqueViolation } from '@/lib/db-helpers';
import {
  AiProviderError,
  resolveResumeAiProvider,
  type ResumeAiProvider,
} from './ai-client';
import {
  getPrimaryResumeDocument,
  hashResumeText,
  loadOwnedResumeDocument,
  ResumeDocumentNotFoundError,
  ResumeStorageError,
  type ResumeDocumentRecord,
} from './documents';
import { extractResumeText } from './extract-text';
import {
  RESUME_AI_TIMEOUT_MS,
  RESUME_MAX_EXTRACTED_CHARS,
  RESUME_STORAGE_FETCH_TIMEOUT_MS,
} from './limits';
import { prepareTextForProvider } from './normalise';
import { verifyCareerExtraction } from './verify';
import {
  EXTRACTION_ERROR_MESSAGES,
  EXTRACTION_SCHEMA_VERSION,
  type CareerExtraction,
  type ExtractionErrorCode,
} from './schema';

/**
 * How long a run may sit in PROCESSING before another request may take it over.
 *
 * A serverless function that is killed mid-request never gets to write FAILED,
 * so without this the row would block that document version forever. Two
 * minutes is far longer than any legitimate extraction, so it cannot cause a
 * live run to be stolen.
 */
const PROCESSING_STALE_MS = 2 * 60 * 1000;

export const AI_RESUME_PARSER_FEATURE = 'AI_RESUME_PARSER' as const;
export const CAREER_PROFILE_FEATURE = 'CAREER_PROFILE_INTELLIGENCE' as const;

export class ResumeNoDocumentError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Upload a resume before running analysis.');
    this.name = 'ResumeNoDocumentError';
  }
}

export class DuplicateExtractionInFlightError extends Error {
  readonly code = 'DUPLICATE_REQUEST';
  readonly status = 409;

  constructor() {
    super('An analysis of this resume is already running.');
    this.name = 'DuplicateExtractionInFlightError';
  }
}

export type ExtractionSummary = {
  id: string;
  resumeId: string;
  status: string;
  schemaVersion: number;
  errorCode: ExtractionErrorCode | null;
  wasTruncated: boolean;
  createdAt: Date;
  completedAt: Date | null;
  model: string | null;
};

export type RunExtractionResult =
  | {
      outcome: 'REUSED';
      extraction: ExtractionSummary;
      data: CareerExtraction;
    }
  | {
      outcome: 'COMPLETED';
      extraction: ExtractionSummary;
      data: CareerExtraction;
      creditsConsumed: number;
    }
  | {
      outcome: 'FAILED';
      extraction: ExtractionSummary | null;
      code: ExtractionErrorCode;
      message: string;
      retryable: boolean;
    };

export type RunExtractionOptions = {
  /** Server-derived. Never read from a request body. */
  userId: string;
  resumeId?: string;
  /**
   * User explicitly asked for a fresh analysis even though a completed result
   * exists for this exact document version. Charged as a new operation.
   */
  force?: boolean;
  route: string;
  /** Injected by tests; production always resolves the configured provider. */
  provider?: ResumeAiProvider;
};

function toSummary(row: {
  id: string;
  resumeId: string;
  status: string;
  schemaVersion: number;
  errorCode: string | null;
  wasTruncated: boolean;
  createdAt: Date;
  completedAt: Date | null;
  model: string | null;
}): ExtractionSummary {
  return {
    id: row.id,
    resumeId: row.resumeId,
    status: row.status,
    schemaVersion: row.schemaVersion,
    errorCode: (row.errorCode as ExtractionErrorCode | null) ?? null,
    wasTruncated: row.wasTruncated,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    model: row.model,
  };
}

/**
 * Claim the extraction row for this document version.
 *
 * The unique index on (resumeId, contentHash, schemaVersion) is the lock. A
 * second request either loses the insert race — and then re-reads and sees a
 * run already in progress — or takes over a row that has been stale long enough
 * that its function must have died.
 */
async function claimExtractionRow(params: {
  userId: string;
  resumeId: string;
  contentHash: string;
}): Promise<{ row: ExtractionRow; claimed: boolean }> {
  const existing = await findExtraction(params);

  if (!existing) {
    try {
      const created = await prisma.resumeExtraction.create({
        data: {
          resumeId: params.resumeId,
          userId: params.userId,
          contentHash: params.contentHash,
          schemaVersion: EXTRACTION_SCHEMA_VERSION,
          status: 'PROCESSING',
        },
      });
      return { row: created, claimed: true };
    } catch (error) {
      // Someone else inserted the same document version first. Fall through and
      // re-read rather than failing the request.
      if (!hasPrismaUniqueViolation(error)) throw error;
      const raced = await findExtraction(params);
      if (!raced) throw error;
      return { row: raced, claimed: false };
    }
  }

  if (existing.status === 'PROCESSING' && !isStale(existing.updatedAt)) {
    return { row: existing, claimed: false };
  }

  // A COMPLETED row is NOT re-claimed here. Overwriting it to PROCESSING would
  // destroy the very result the caller is about to reuse, and would lose the
  // stored extraction if the request then failed. Callers check for a reusable
  // result before claiming; reaching this point means genuinely re-running.

  // FAILED rows are retried in place, and stale PROCESSING rows are taken over,
  // so the same document version never accumulates one row per attempt.
  const updated = await prisma.resumeExtraction.update({
    where: { id: existing.id },
    data: { status: 'PROCESSING', errorCode: null, completedAt: null },
  });
  return { row: updated, claimed: true };
}

type ExtractionRow = {
  id: string;
  userId: string;
  resumeId: string;
  status: string;
  schemaVersion: number;
  data: unknown;
  errorCode: string | null;
  wasTruncated: boolean;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  model: string | null;
  provider: string | null;
};

function findExtraction(params: {
  resumeId: string;
  contentHash: string;
}): Promise<ExtractionRow | null> {
  return prisma.resumeExtraction.findUnique({
    where: {
      resumeId_contentHash_schemaVersion: {
        resumeId: params.resumeId,
        contentHash: params.contentHash,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
      },
    },
  });
}

function isStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > PROCESSING_STALE_MS;
}

/**
 * Run an analysis for one document version.
 *
 * Expected to throw `PlanRequiredError` (403) or `UsageLimitExceededError` (403)
 * before touching a provider. `AiProviderError` is captured into the result
 * instead, so a provider outage is a recoverable state the UI can offer a retry
 * for rather than a 500.
 */
export async function runResumeExtraction(
  options: RunExtractionOptions,
): Promise<RunExtractionResult> {
  const { userId, route } = options;

  // 3. Entitlement. Throws PlanRequiredError, which the route maps to 403.
  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, AI_RESUME_PARSER_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'resume_parse_denied',
      userId,
      route,
      context: { feature: AI_RESUME_PARSER_FEATURE },
    });
    throw error;
  }

  // 2 + 4. Resolve a document the caller owns, then load it.
  //
  // A requested id that is missing, or that belongs to someone else, raises
  // ResumeDocumentNotFoundError — a 404 identical in shape to a document that
  // genuinely does not exist. Only "you have not uploaded anything yet" gets
  // the softer ResumeNoDocumentError, because that is a real, actionable state
  // for this user rather than a probe.
  let document: ResumeDocumentRecord | null;
  if (options.resumeId) {
    document = await prisma.resumeDocument.findFirst({
      where: { id: options.resumeId, userId },
    });
    if (!document) throw new ResumeDocumentNotFoundError();
  } else {
    document = await getPrimaryResumeDocument(userId);
    if (!document) throw new ResumeNoDocumentError();
  }

  await logImportantInfo({
    event: 'resume_parse_started',
    userId,
    route,
    context: { resumeId: document.id, force: options.force === true },
  });

  const { bytes } = await loadOwnedResumeDocument({ userId, resumeId: document.id });

  const extracted = await extractResumeText(bytes, document.fileName, {
    timeoutMs: RESUME_STORAGE_FETCH_TIMEOUT_MS,
  });

  if (!extracted.ok) {
    await logImportantInfo({
      event: 'resume_parse_failed',
      userId,
      route,
      context: { resumeId: document.id, code: extracted.code },
    });
    return {
      outcome: 'FAILED',
      extraction: null,
      code: extracted.code,
      message: extracted.message,
      retryable: extracted.code !== 'UNSUPPORTED_FORMAT',
    };
  }

  // Hash the text we are about to send, not the bytes: an identical resume that
  // was re-exported produces the same hash and reuses the cached result.
  const contentHash = hashResumeText(extracted.text);

  // Reuse is checked BEFORE the row is claimed. Claiming flips the row to
  // PROCESSING, so checking afterwards would destroy the very result being
  // reused and lose it if this request then failed.
  if (!options.force) {
    const reusable = await findExtraction({ resumeId: document.id, contentHash });
    if (reusable?.status === 'COMPLETED' && reusable.data) {
      await logImportantInfo({
        event: 'resume_parse_reused',
        userId,
        route,
        context: { resumeId: document.id, extractionId: reusable.id },
      });
      return {
        outcome: 'REUSED',
        extraction: toSummary(reusable),
        data: reusable.data as CareerExtraction,
      };
    }
  }

  const { row, claimed } = await claimExtractionRow({
    userId,
    resumeId: document.id,
    contentHash,
  });

  // Another request for this exact document version is mid-flight. Refusing is
  // what prevents two identical expensive calls racing each other.
  if (!claimed && row.status === 'PROCESSING') {
    throw new DuplicateExtractionInFlightError();
  }

  // 5. Usage. Reserved immediately before the provider call, under the existing
  // advisory lock, so parallel requests serialise and a retry of this same
  // document version is not charged twice.
  const idempotencyKey = options.force
    ? `resume-extract:${row.id}:forced`
    : `resume-extract:${row.id}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    // Admins hold the platform's credentials, not a customer subscription, so
    // their usage is recorded as zero. This is the existing exemption, applied
    // consistently rather than at the gate only.
    await logImportantInfo({
      event: 'resume_parse_admin_bypass',
      userId,
      route,
      context: { resumeId: document.id, extractionId: row.id },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, AI_RESUME_PARSER_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'resume_parse_usage_denied',
          userId,
          route,
          context: { feature: AI_RESUME_PARSER_FEATURE, limit: error.limit, used: error.used },
        });
      }
      throw error;
    }
  }

  // 7. Provider call. No transaction is open and no row lock is held.
  const prepared = prepareTextForProvider(extracted.text, RESUME_MAX_EXTRACTED_CHARS);
  let provider: ResumeAiProvider;
  try {
    provider = options.provider ?? resolveResumeAiProvider();
  } catch (error) {
    await markFailed(row.id, error);
    return failureFor(row.id, error);
  }

  let data: CareerExtraction;
  try {
    const raw = await provider.extract(prepared.text);
    // Re-validated and re-checked against the document before anything is
    // stored: evidence levels are corrected here, dates are normalised, URLs
    // are reduced to http/https, and empty rows are dropped. This is what makes
    // the stored extraction safe to show a user as "supported by resume" — and
    // it is why the raw resume text never has to be persisted.
    data = verifyCareerExtraction(raw, extracted.text);
  } catch (error) {
    await markFailed(row.id, error);
    await logImportantError({
      event: 'resume_parse_failed',
      userId,
      route,
      error,
      context: { resumeId: document.id, extractionId: row.id, code: providerCode(error) },
    });
    return failureFor(row.id, error);
  }

  // 8. Record the outcome.
  const completed = await prisma.resumeExtraction.update({
    where: { id: row.id },
    data: {
      status: 'COMPLETED',
      data: data as unknown as object,
      errorCode: null,
      completedAt: new Date(),
      wasTruncated: prepared.truncated,
      extractedChars: extracted.text.length,
      provider: provider.name,
      model: provider.model,
    },
  });

  await logImportantInfo({
    event: 'resume_parse_succeeded',
    userId,
    route,
    context: {
      resumeId: document.id,
      extractionId: completed.id,
      model: provider.model,
      truncated: prepared.truncated,
      creditsConsumed,
    },
  });

  return {
    outcome: 'COMPLETED',
    extraction: toSummary(completed),
    data,
    creditsConsumed,
  };
}

async function markFailed(extractionId: string, error: unknown): Promise<void> {
  await prisma.resumeExtraction
    .update({
      where: { id: extractionId },
      data: { status: 'FAILED', errorCode: providerCode(error), completedAt: new Date() },
    })
    .catch(() => undefined);
}

function providerCode(error: unknown): ExtractionErrorCode {
  if (error instanceof AiProviderError) return error.code;
  return 'AI_UNAVAILABLE';
}

async function failureFor(extractionId: string, error: unknown): Promise<RunExtractionResult> {
  const code = providerCode(error);
  const row = await prisma.resumeExtraction
    .findUnique({ where: { id: extractionId } })
    .catch(() => null);

  return {
    outcome: 'FAILED',
    extraction: row ? toSummary(row) : null,
    code,
    message: EXTRACTION_ERROR_MESSAGES[code],
    // Taken from the error itself rather than recomputed here, so the value the
    // UI is told matches the value the provider boundary decided on.
    retryable: error instanceof AiProviderError ? error.retryable : true,
  };
}

/**
 * Load a completed extraction for review.
 *
 * Ownership is part of the query, so another user's extraction is a 404 rather
 * than a 403 — the response must not confirm that it exists.
 */
export async function getExtractionForReview(params: {
  userId: string;
  extractionId: string;
}): Promise<{
  extraction: ExtractionSummary;
  data: CareerExtraction;
  resume: { id: string; fileName: string; format: string };
}> {
  const row = await prisma.resumeExtraction.findFirst({
    where: { id: params.extractionId, userId: params.userId },
    include: { resume: { select: { id: true, fileName: true, format: true } } },
  });

  if (!row || row.status !== 'COMPLETED' || !row.data) {
    throw new ResumeDocumentNotFoundError();
  }

  return {
    extraction: toSummary(row),
    data: row.data as CareerExtraction,
    resume: row.resume,
  };
}

export { PlanRequiredError, ResumeDocumentNotFoundError, ResumeStorageError };