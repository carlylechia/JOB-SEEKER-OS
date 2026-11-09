/**
 * Error type used by the admin user deletion flow.
 *
 * Lives in a library module (not a route file) because Next.js type generation
 * treats every export of a route handler file as a possible handler.
 */
export type AdminUserDeleteErrorCode =
  | 'VALIDATION_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'AUDIT_FAILED'
  | 'INTERNAL_ERROR';

export class AdminUserDeleteError extends Error {
  readonly code: AdminUserDeleteErrorCode;

  constructor(code: AdminUserDeleteErrorCode, message: string) {
    super(message);
    this.name = 'AdminUserDeleteError';
    this.code = code;
  }
}
