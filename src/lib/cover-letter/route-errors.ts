/**
 * Shared error mapping for cover letter routes.
 *
 * Domain errors carry a `code` and a `status`; this turns them into the
 * application's standard `{ error: { code, message } }` envelope with the
 * right HTTP status. Provider messages, stack traces and Prisma errors never
 * reach the browser — anything unmapped is re-thrown so `handleRoute` logs it
 * and returns a generic 500.
 */

import { apiError, type ApiErrorCode } from '@/lib/api';
import { PlanRequiredError } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError } from '@/lib/billing/usage';
import { CoverLetterNotFoundError, DuplicateCoverLetterInFlightError } from './service';
import { CoverLetterAiError } from './ai-client';
import { COVER_LETTER_ERROR_MESSAGES } from './schema';

type Mapped = { code: ApiErrorCode; message: string; meta?: Record<string, unknown> };

function map(error: unknown): Mapped | null {
  if (error instanceof PlanRequiredError) {
    return {
      code: 'PLAN_REQUIRED',
      message: 'Cover letters are available on Pro. Your existing jobs and letters stay exactly as they are.',
      meta: { feature: error.feature, requiredPlan: error.requiredPlan },
    };
  }

  if (error instanceof UsageLimitExceededError) {
    return {
      code: 'USAGE_LIMIT_EXCEEDED',
      message: 'You have used all of this month’s cover letter credits. They reset at the start of the next period.',
      meta: { feature: error.feature, used: error.used, limit: error.limit },
    };
  }

  if (error instanceof CoverLetterNotFoundError) {
    // Identical for "missing", "deleted" and "belongs to someone else":
    // the response must not confirm that another user's letter exists.
    return { code: 'NOT_FOUND', message: 'Cover letter not found.' };
  }

  if (error instanceof DuplicateCoverLetterInFlightError) {
    return { code: 'DUPLICATE_REQUEST', message: error.message };
  }

  if (error instanceof CoverLetterAiError) {
    return {
      code: 'AI_UNAVAILABLE',
      message:
        COVER_LETTER_ERROR_MESSAGES[error.code as keyof typeof COVER_LETTER_ERROR_MESSAGES] ??
        COVER_LETTER_ERROR_MESSAGES.AI_UNAVAILABLE,
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
export function coverLetterErrorResponse(error: unknown, request: Request): Response {
  const mapped = map(error);
  if (!mapped) throw error;
  return apiError(mapped.code, mapped.message, { request, meta: mapped.meta });
}
