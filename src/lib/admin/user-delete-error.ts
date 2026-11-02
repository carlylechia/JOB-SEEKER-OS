/**
 * Error type used by the admin user deletion flow.
 *
 * Lives in a library module (not a route file) because Next.js type generation
 * treats every export of a route handler file as a possible handler.
 */
export class AdminUserDeleteError extends Error {
  readonly code: 'NOT_FOUND' | 'CONFLICT';

  constructor(code: 'NOT_FOUND' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'AdminUserDeleteError';
    this.code = code;
  }
}
