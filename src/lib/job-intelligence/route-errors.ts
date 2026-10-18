/**
 * Shared error mapping for AI Job Intelligence routes.
 *
 * Domain errors carry a `code` and a `status`; this turns them into the
 * application's standard `{ error: { code, message } }` envelope with the right
 * HTTP status. Provider messages, stack traces and Prisma errors never reach
 * the browser — anything unmapped is re-thrown so `handleRoute` logs it and
 * returns a generic 500.
 *
 * The copy is specific about what a user can do. "Something went wrong" tells
 * a job seeker nothing; "Ask the employer whether this role is open to your
 * region" tells them their next move.
 */

import { apiError, type ApiErrorCode } from '@/lib/api';
import { PlanRequiredError } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError } from '@/lib/billing/usage';
import {
  DuplicateAnalysisInFlightError,
  JobIntelligenceAiError,
  JobNotFoundError,
} from './service';
import { ANALYSIS_ERROR_MESSAGES } from './schema';

type Mapped = { code: ApiErrorCode; message: string; meta?: Record<string, unknown> };

function map(error: unknown): Mapped | null {
  if (error instanceof PlanRequiredError) {
    return {
      code: 'PLAN_REQUIRED',
      message: 'AI job analysis is available on Pro. Your jobs and scoring stay exactly as they are.',
      meta: { feature: error.feature, requiredPlan: error.requiredPlan },
    };
  }

  if (error instanceof UsageLimitExceededError) {
    return {
      code: 'USAGE_LIMIT_EXCEEDED',
      message: 'You have used all of this month’s job analyses. They reset on the 1st.',
      meta: { feature: error.feature, used: error.used, limit: error.limit },
    };
  }

  if (error instanceof JobNotFoundError) {
    // Identical for "missing", "deleted" and "belongs to someone else" on
    // purpose: the response must not confirm that another user's job exists.
    return { code: 'NOT_FOUND', message: 'Job not found.' };
  }

  if (error instanceof DuplicateAnalysisInFlightError) {
    return { code: 'DUPLICATE_REQUEST', message: error.message };
  }

  if (error instanceof JobIntelligenceAiError) {
    return {
      code: 'AI_UNAVAILABLE',
      message: ANALYSIS_ERROR_MESSAGES[error.code],
      meta: { code: error.code, retryable: error.retryable },
    };
  }

  return null;
}

/**
 * Returns a Response for a known domain error.
 *
 * An unrecognised error is re-thrown rather than guessed at, so `handleRoute`
 * logs it with a stack and returns a generic 500.
 */
export function jobIntelligenceErrorResponse(error: unknown, request: Request): Response {
  const mapped = map(error);
  if (!mapped) throw error;
  return apiError(mapped.code, mapped.message, { request, meta: mapped.meta });
}