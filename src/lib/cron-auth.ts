/**
 * Cron authorization.
 *
 * FAIL CLOSED. The previous implementation only checked the bearer token when
 * `CRON_SECRET` happened to be set, so a missing configuration silently
 * exposed the maintenance endpoint to the public internet. These helpers refuse
 * to authenticate anything unless a sufficiently long secret is configured.
 */

const MIN_SECRET_LENGTH = 16;

/**
 * True when the request presents the correct bearer token.
 *
 * Returns false — never true — when CRON_SECRET is unset or too short.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;

  const header = request.headers.get('authorization');
  if (typeof header !== 'string') return false;

  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;

  // Constant-time comparison to avoid leaking the secret through timing.
  let mismatch = 0;
  for (let i = 0; i < header.length; i += 1) {
    mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Whether cron auth is usable at all, for health reporting. */
export function isCronConfigured(): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && secret.length >= MIN_SECRET_LENGTH);
}