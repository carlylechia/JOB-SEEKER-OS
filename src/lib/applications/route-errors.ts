/**
 * Error mapping for application lifecycle routes.
 *
 * Unmapped errors are re-thrown so `handleRoute` logs them and returns a safe
 * 500. Submission-evidence failures are 422, never 500: they are a user-fixable
 * state, and the message tells them exactly what to do.
 */

import { apiError, type ApiErrorCode } from '@/lib/api';
import {
  ApplicationNotFoundError,
  ApplicationTransitionError,
  AttemptValidationError,
  SubmissionEvidenceRequiredError,
} from './service';

type Mapped = {
  code: ApiErrorCode;
  message: string;
  meta?: Record<string, unknown>;
};

function map(error: unknown): Mapped | null {
  if (error instanceof ApplicationNotFoundError) {
    return { code: 'NOT_FOUND', message: error.message };
  }
  if (error instanceof ApplicationTransitionError) {
    return {
      code: 'INVALID_TRANSITION',
      message: error.message,
      meta: { from: error.from, to: error.to },
    };
  }
  if (error instanceof SubmissionEvidenceRequiredError) {
    return { code: 'VALIDATION_FAILED', message: error.message };
  }
  if (error instanceof AttemptValidationError) {
    return { code: 'VALIDATION_FAILED', message: error.message };
  }
  return null;
}

export function applicationErrorResponse(
  error: unknown,
  request: Request,
): Response | null {
  const mapped = map(error);
  if (!mapped) return null;
  return apiError(mapped.code, mapped.message, { request, meta: mapped.meta });
}
