import { JobStatus } from '@/types';

/**
 * Every pair is a translucent wash + a `-text` token. The tokens resolve to a
 * deepened hue on light surfaces and the original pre-redesign tint on dark,
 * so contrast holds in both themes without per-theme markup.
 */
const map: Record<JobStatus, string> = {
  LEAD: 'bg-surface-sunken text-ink',
  SAVED: 'bg-accent/15 text-accent-text',
  APPLYING: 'bg-[rgb(var(--indigo-text)/0.15)] text-indigo-text',
  APPLIED: 'bg-success/15 text-success-text',
  INTERVIEWING: 'bg-warn/15 text-warn-text',
  OFFER: 'bg-[rgb(var(--success-text)/0.15)] text-success-text',
  REJECTED: 'bg-danger/15 text-danger-text',
  ARCHIVED: 'bg-muted/10 text-muted',
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge ${map[status]}`}>{status.replace('_', ' ')}</span>;
}