/**
 * Injectable clock.
 *
 * Billing logic must be testable without waiting 14 real days, and must never
 * call `new Date()` directly — that scattered through billing code makes trial
 * expiry effectively untestable and invites timezone bugs.
 *
 * Production uses the real clock. Tests override `setTestNow`.
 */

let testNow: Date | null = null;

/** Current instant in UTC. The only sanctioned time source for billing logic. */
export function now(): Date {
  return testNow ? new Date(testNow.getTime()) : new Date();
}

/**
 * Overrides the clock. Intended for tests only — call `resetClock()` in
 * teardown. Refuses to run in production so a stray call can never freeze
 * real billing state.
 */
export function setTestNow(date: Date | null): void {
  if (process.env.NODE_ENV === 'production' && date !== null) {
    throw new Error('setTestNow() is not permitted in production.');
  }
  testNow = date ? new Date(date.getTime()) : null;
}

export function resetClock(): void {
  testNow = null;
}

/** Adds whole days to an instant, returning a new UTC Date. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Start of the current UTC calendar month. Usage is metered against explicit
 * UTC periods so it stays auditable and never depends on user locale.
 */
export function startOfUtcPeriod(date: Date = now()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Exclusive end of the UTC month containing `date`. */
export function endOfUtcPeriod(date: Date = now()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** Whole days remaining until `target`, floored, never negative. */
export function daysUntil(target: Date, from: Date = now()): number {
  const ms = target.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}