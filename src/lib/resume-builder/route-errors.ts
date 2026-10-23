/**
 * Shared error mapping for the Resume Builder routes.
 *
 * Domain errors carry a `code` and a `status`; this turns them into the
 * application's standard `{ error: { code, message } }` envelope with the right
 * HTTP status. Provider messages, stack traces and Prisma errors never reach the
 * browser — anything unmapped is re-thrown so `handleRoute` logs it and returns
 * a generic 500.
 *
 * The copy is specific about what a user can do. "Something went wrong" tells a
 * job seeker nothing; "Duplicate this resume and try again" tells them their next
 * move.
 */

import { apiError, type ApiErrorCode } from '@/lib/api';
import { PlanRequiredError } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError } from '@/lib/billing/usage';
import {
  ResumeLimitExceededError,
  ResumeRevisionConflictError,
  StructuredResumeNotFoundError,
  TargetJobNotFoundError,
} from './documents';
import {
  DuplicateOptimizationInFlightError,
  EditedTextRejectedError,
  InformationGapNotFoundError,
  NoOperationsAcceptedError,
  NoTargetJobError,
  OptimizationStaleError,
  ResumeOptimizationAiError,
  RefinedAnswerRejectedError,
} from './optimization/service';
import { OPTIMIZATION_ERROR_MESSAGES, type OptimizationErrorCode } from './optimization/schema';
import { OnePageDoesNotFitError, OnePageSelectionError } from './one-page-errors';

type Mapped = { code: ApiErrorCode; message: string; meta?: Record<string, unknown> };

function map(error: unknown): Mapped | null {
  if (error instanceof PlanRequiredError) {
    return {
      code: 'PLAN_REQUIRED',
      message: `${errorMessageForFeature(error.feature)}. Your resumes and every other feature stay exactly as they are.`,
      meta: { feature: error.feature, requiredPlan: error.requiredPlan },
    };
  }

  if (error instanceof UsageLimitExceededError) {
    return {
      code: 'USAGE_LIMIT_EXCEEDED',
      message: 'You have used all of this month’s AI credits. They reset on the 1st.',
      meta: { feature: error.feature, used: error.used, limit: error.limit },
    };
  }

  if (error instanceof ResumeLimitExceededError) {
    return {
      code: 'FORBIDDEN',
      message: error.message,
      meta: { limit: error.limit, used: error.used },
    };
  }

  if (error instanceof OnePageDoesNotFitError || error instanceof OnePageSelectionError) {
    return {
      code: 'VALIDATION_FAILED',
      message: error.message,
      ...(error instanceof OnePageDoesNotFitError ? { meta: { pageCount: error.pageCount } } : {}),
    };
  }

  if (error instanceof ResumeRevisionConflictError) {
    return {
      code: 'CONFLICT',
      message: error.message,
      meta: { currentRevision: error.currentRevision },
    };
  }

  if (error instanceof StructuredResumeNotFoundError) {
    // Identical for "missing" and "belongs to someone else" on purpose: the
    // response must not confirm that another user's resume exists.
    return { code: 'NOT_FOUND', message: error.message };
  }

  if (error instanceof TargetJobNotFoundError) {
    return { code: 'NOT_FOUND', message: 'Job not found.' };
  }

  if (error instanceof NoTargetJobError) {
    return { code: 'NOT_FOUND', message: error.message };
  }

  if (error instanceof NoOperationsAcceptedError) {
    return { code: 'VALIDATION_FAILED', message: error.message };
  }

  if (error instanceof EditedTextRejectedError) {
    return { code: 'VALIDATION_FAILED', message: error.message };
  }

  if (error instanceof RefinedAnswerRejectedError) {
    return { code: 'VALIDATION_FAILED', message: error.message };
  }

  if (error instanceof InformationGapNotFoundError) {
    return { code: 'NOT_FOUND', message: error.message };
  }

  if (error instanceof OptimizationStaleError) {
    return {
      code: 'CONFLICT',
      message: error.message,
      meta: { stale: true },
    };
  }

  if (error instanceof DuplicateOptimizationInFlightError) {
    return { code: 'DUPLICATE_REQUEST', message: error.message };
  }

  if (error instanceof ResumeOptimizationAiError) {
    return {
      code: 'AI_UNAVAILABLE',
      message: OPTIMIZATION_ERROR_MESSAGES[error.code as OptimizationErrorCode],
      meta: { code: error.code, retryable: error.retryable },
    };
  }

  // Matched on the stable `code` rather than by importing the class. This module
  // is imported by every resume route, and importing `pdf.ts` from here would
  // drag pdf-lib and the font loader into routes that never touch a PDF. The
  // error is still raised by `pdf.ts`; only the matching is decoupled.
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'PDF_ENGINE_NOT_READY'
  ) {
    // A server fault, not the user's. Says so plainly rather than implying they
    // did something wrong.
    return { code: 'AI_UNAVAILABLE', message: 'Export is warming up. Please try again in a moment.' };
  }

  return null;
}

/** Feature-specific upgrade copy, so the message names what is missing. */
function errorMessageForFeature(feature: string): string {
  switch (feature) {
    case 'RESUME_OPTIMIZATION':
      return 'Resume optimisation is available on Pro. Everything else about your resumes stays exactly as it is.';
    case 'RESUME_BUILDER':
      return 'The resume builder is available on Pro. Your uploads, profiles and jobs stay exactly as they are.';
    default:
      return 'That is available on Pro. Everything else about your account stays exactly as it is.';
  }
}

/**
 * Returns a Response for a known domain error.
 *
 * An unrecognised error is re-thrown rather than guessed at, so `handleRoute`
 * logs it with a stack and returns a generic 500.
 */
export function resumeBuilderErrorResponse(error: unknown, request: Request): Response {
  const mapped = map(error);
  if (!mapped) throw error;
  return apiError(mapped.code, mapped.message, { request, meta: mapped.meta });
}
