import type { JobStatus } from '@/types';

/**
 * Statuses where the user is still actively pursuing the role.
 *
 * This is an allowlist on purpose: a future terminal status (rejected,
 * archived, declined, abandoned, ...) must never quietly re-enter the queue or
 * the dashboard's interview prompts just because nobody updated a denylist.
 *
 * OFFER is intentionally excluded from "active": the pursuit is over, and the
 * queue should not keep asking the user to apply, follow up, or practise for
 * an interview they have already won.
 */
export const ACTIVE_JOB_STATUSES = [
  'LEAD',
  'SAVED',
  'APPLYING',
  'APPLIED',
  'INTERVIEWING',
] as const satisfies readonly JobStatus[];

const ACTIVE_JOB_STATUS_SET = new Set<string>(ACTIVE_JOB_STATUSES);

export function isActiveJobStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && ACTIVE_JOB_STATUS_SET.has(status);
}
