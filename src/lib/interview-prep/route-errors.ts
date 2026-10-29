/**
 * Shared error mapping for interview preparation routes.
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
import {
  DuplicatePrepGenerationInFlightError,
  InterviewPrepJobNotFoundError,
  InterviewPrepPackNotFoundError,
  PracticeAnswerTooShortError,
  PrepSessionNotFoundError,
  PrepValidationError,
} from './service';
import { InterviewPrepAiError } from './ai-client';
import { ResearchFetchError } from './research';
import { INTERVIEW_PREP_ERROR_MESSAGES } from './schema';

type Mapped = { code: ApiErrorCode; message: string; meta?: Record<string, unknown> };

function map(error: unknown): Mapped | null {
  if (error instanceof PlanRequiredError) {
    return {
      code: 'PLAN_REQUIRED',
      message: 'Interview preparation is available on Pro. Your existing jobs and prep packs stay exactly as they are.',
      meta: { feature: error.feature, requiredPlan: error.requiredPlan },
    };
  }

  if (error instanceof UsageLimitExceededError) {
    return {
      code: 'USAGE_LIMIT_EXCEEDED',
      message: 'You have used all of this month’s preparation credits. They reset at the start of the next period.',
      meta: { feature: error.feature, used: error.used, limit: error.limit },
    };
  }

  if (error instanceof InterviewPrepPackNotFoundError) {
    // Identical for "missing", "deleted" and "belongs to someone else":
    // the response must not confirm that another user's pack exists.
    return { code: 'NOT_FOUND', message: 'Preparation pack not found.' };
  }

  if (error instanceof InterviewPrepJobNotFoundError) {
    return { code: 'NOT_FOUND', message: 'That job could not be found.' };
  }

  if (error instanceof PrepSessionNotFoundError) {
    return { code: 'NOT_FOUND', message: 'Practice session not found.' };
  }

  if (error instanceof DuplicatePrepGenerationInFlightError) {
    return { code: 'DUPLICATE_REQUEST', message: error.message };
  }

  if (error instanceof PracticeAnswerTooShortError || error instanceof PrepValidationError) {
    return { code: 'VALIDATION_FAILED', message: error.message };
  }

  if (error instanceof ResearchFetchError) {
    return { code: 'VALIDATION_FAILED', message: error.message, meta: { code: error.code } };
  }

  if (error instanceof InterviewPrepAiError) {
    return {
      code: 'AI_UNAVAILABLE',
      message: INTERVIEW_PREP_ERROR_MESSAGES[error.code as keyof typeof INTERVIEW_PREP_ERROR_MESSAGES] ?? INTERVIEW_PREP_ERROR_MESSAGES.AI_UNAVAILABLE,
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
export function interviewPrepErrorResponse(error: unknown, request: Request): Response {
  const mapped = map(error);
  if (!mapped) throw error;
  return apiError(mapped.code, mapped.message, { request, meta: mapped.meta });
}
