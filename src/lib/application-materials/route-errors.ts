/**
 * Shared error mapping for AI application materials routes.
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
import {
  ApplicationMaterialAiError,
  DuplicateGenerationInFlightError,
  JobNotFoundError,
} from './service';
import { StructuredResumeNotFoundError } from '@/lib/resume-builder/documents';
import { MATERIAL_ERROR_MESSAGES, type MaterialErrorCode } from './schema';

type Mapped = { code: ApiErrorCode; message: string; meta?: Record<string, unknown> };

function map(error: unknown): Mapped | null {
  if (error instanceof PlanRequiredError) {
    return {
      code: 'PLAN_REQUIRED',
      message: 'AI application materials are available on Pro. Your saved templates and drafts stay exactly as they are.',
      meta: { feature: error.feature, requiredPlan: error.requiredPlan },
    };
  }

  if (error instanceof UsageLimitExceededError) {
    return {
      code: 'USAGE_LIMIT_EXCEEDED',
      message: 'You have used all of this month\u2019s AI materials. They reset on the 1st.',
      meta: { feature: error.feature, used: error.used, limit: error.limit },
    };
  }

  if (error instanceof JobNotFoundError) {
    return { code: 'NOT_FOUND', message: 'Job not found.' };
  }

  if (error instanceof StructuredResumeNotFoundError) {
    return { code: 'NOT_FOUND', message: 'The selected resume could not be found.' };
  }

  if (error instanceof DuplicateGenerationInFlightError) {
    return { code: 'DUPLICATE_REQUEST', message: error.message };
  }

  if (error instanceof ApplicationMaterialAiError) {
    return {
      code: 'AI_UNAVAILABLE',
      message: MATERIAL_ERROR_MESSAGES[error.code as MaterialErrorCode],
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
export function applicationMaterialErrorResponse(error: unknown, request: Request): Response {
  const mapped = map(error);
  if (!mapped) throw error;
  return apiError(mapped.code, mapped.message, { request, meta: mapped.meta });
}
