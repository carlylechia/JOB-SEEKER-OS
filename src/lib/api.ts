import { NextResponse } from 'next/server';
import { withCors } from './cors';

/**
 * Stable machine-readable error codes. Clients and tests assert on these, never
 * on message text, so copy can change without breaking anything.
 */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'PLAN_REQUIRED'
  | 'USAGE_LIMIT_EXCEEDED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_REQUEST'
  | 'INVALID_TRANSITION'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  PLAN_REQUIRED: 403,
  USAGE_LIMIT_EXCEEDED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_REQUEST: 409,
  INVALID_TRANSITION: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export function jsonOk<T>(data: T, request?: Request, init?: ResponseInit) {
  return withCors(NextResponse.json(data, init), request);
}

export function jsonError(message: string, status = 400, details?: string[], request?: Request) {
  return withCors(NextResponse.json({ error: message, details }, { status }), request);
}

/**
 * Structured error envelope.
 *
 *   { "error": { "code": "PLAN_REQUIRED", "message": "...", ...safeMeta } }
 *
 * Only safe metadata is ever included — never a Prisma error, stack trace,
 * token, or internal detail. Those are logged server-side instead.
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  options?: { request?: Request; meta?: Record<string, unknown>; status?: number },
) {
  const status = options?.status ?? STATUS_FOR_CODE[code] ?? 400;
  return withCors(
    NextResponse.json({ error: { code, message, ...(options?.meta ?? {}) } }, { status }),
    options?.request,
  );
}

/**
 * Private, per-user data must never be cached by a CDN or shared cache.
 * Apply to every authenticated/billing/admin response.
 */
export function privateNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

/** Wrap an async handler so unexpected errors become a safe 500. */
export async function handleRoute(
  fn: () => Promise<Response>,
  context: { event: string; route: string; userId?: string },
): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    const { logImportantError } = await import('./observability');
    await logImportantError({
      event: context.event,
      userId: context.userId,
      route: context.route,
      error,
    });
    return apiError('INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }
}