/**
 * Shared helpers for a `?job=` preselection.
 *
 * The job page links into the resume and application-material builders with a
 * target id in the query string. The id is untrusted: it is length- and
 * character-bounded here, then ownership is checked against the caller's own
 * jobs by the server query. A selector must never show an id the user cannot
 * actually target.
 */

const TARGET_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function sanitizeTargetJobId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !TARGET_JOB_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function preselectedTargetJobId(
  requested: string | null | undefined,
  jobs: Array<{ id: string }>,
): string {
  const id = sanitizeTargetJobId(requested);
  if (!id) return '';
  return jobs.some((job) => job.id === id) ? id : '';
}
