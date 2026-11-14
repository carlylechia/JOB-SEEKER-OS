/**
 * Error mapping for the preparation routes.
 *
 * Domain errors carry a stable code; this converts them to the application's
 * `{ error: { code, message } }` envelope. Anything unmapped is re-thrown so
 * `handleRoute` logs it and returns a generic 500 instead of leaking a provider
 * or database detail.
 */

import { apiError, type ApiErrorCode } from '@/lib/api';
import { PlanRequiredError } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError } from '@/lib/billing/usage';
import {
  PreparationJobNotFoundError,
  PreparationRunNotFoundError,
  PreparationValidationError,
} from './service';

type Mapped = {
  code: ApiErrorCode;
  message: string;
  meta?: Record<string, unknown>;
};

function map(error: unknown): Mapped | null {
  if (error instanceof PreparationJobNotFoundError) {
    return { code: 'NOT_FOUND', message: error.message };
  }

  if (error instanceof PreparationRunNotFoundError) {
    return { code: 'NOT_FOUND', message: error.message };
  }

  if (error instanceof PreparationValidationError) {
    return { code: 'VALIDATION_FAILED', message: error.message };
  }

  if (error instanceof PlanRequiredError) {
    return {
      code: 'PLAN_REQUIRED',
      message:
        'Preparing this material needs a plan that includes the relevant AI feature. Your existing documents are unchanged.',
      meta: { feature: error.feature, requiredPlan: error.requiredPlan },
    };
  }

  if (error instanceof UsageLimitExceededError) {
    return {
      code: 'USAGE_LIMIT_EXCEEDED',
      message:
        'You have used all of this month’s AI credits for that feature. They reset on the 1st; everything already generated is still available.',
      meta: { feature: error.feature, used: error.used, limit: error.limit },
    };
  }

  return null;
}

/** Returns a response when the error is a known domain error, otherwise null. */
export function preparationErrorResponse(
  error: unknown,
  request: Request,
): Response | null {
  const mapped = map(error);
  if (!mapped) return null;
  return apiError(mapped.code, mapped.message, { request, meta: mapped.meta });
}
