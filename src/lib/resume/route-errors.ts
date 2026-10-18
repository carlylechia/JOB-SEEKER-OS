/**
 * Shared error mapping for Resume Intelligence routes.
 *
 * Domain errors carry a `code` and a `status`; this turns them into the
 * application's standard `{ error: { code, message } }` envelope with the right
 * HTTP status. Provider messages, stack traces and Prisma errors never reach
 * the browser — anything unmapped is re-thrown so `handleRoute` logs it and
 * returns a generic 500.
 */

import { apiError, type ApiErrorCode } from '@/lib/api';
import { PlanRequiredError } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError } from '@/lib/billing/usage';
import { ProfileVersionConflictError } from './career-profile';
import { ResumeDocumentNotFoundError, ResumeStorageError } from './documents';
import { DuplicateExtractionInFlightError, ResumeNoDocumentError } from './service';

type Mapped = { code: ApiErrorCode; message: string; meta?: Record<string, unknown> };

function map(error: unknown): Mapped | null {
  if (error instanceof PlanRequiredError) {
    return {
      code: 'PLAN_REQUIRED',
      message: 'Resume analysis is available on Pro. Upgrade to build your career profile.',
      meta: { feature: error.feature, requiredPlan: error.requiredPlan },
    };
  }

  if (error instanceof UsageLimitExceededError) {
    return {
      code: 'USAGE_LIMIT_EXCEEDED',
      message: 'You have used all of this month’s resume analyses. They reset on the 1st.',
      meta: { feature: error.feature, used: error.used, limit: error.limit },
    };
  }

  if (error instanceof ResumeNoDocumentError) {
    return { code: 'NOT_FOUND', message: 'Upload a resume before running analysis.' };
  }

  if (error instanceof ResumeDocumentNotFoundError) {
    // Identical for "missing" and "belongs to someone else" on purpose: the
    // response must not confirm that another user's resume exists.
    return { code: 'NOT_FOUND', message: 'Resume not found.' };
  }

  if (error instanceof ResumeStorageError) {
    return { code: 'AI_UNAVAILABLE', message: error.message };
  }

  if (error instanceof DuplicateExtractionInFlightError) {
    return { code: 'DUPLICATE_REQUEST', message: error.message };
  }

  if (error instanceof ProfileVersionConflictError) {
    return { code: 'CONFLICT', message: error.message };
  }

  return null;
}

/**
 * Returns a Response for a known domain error.
 *
 * An unrecognised error is re-thrown rather than guessed at, so `handleRoute`
 * logs it with a stack and returns a generic 500.
 */
export function resumeErrorResponse(error: unknown, request: Request): Response {
  const mapped = map(error);
  if (!mapped) throw error;
  return apiError(mapped.code, mapped.message, { request, meta: mapped.meta });
}