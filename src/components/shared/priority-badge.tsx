import { PriorityFlag } from '@/types';

const map: Record<PriorityFlag, string> = {
  APPLY_TODAY: 'bg-success/15 text-success-text',
  APPLY_THIS_WEEK: 'bg-accent/15 text-accent-text',
  PREPARE_ASSETS: 'bg-[rgb(var(--violet-text)/0.15)] text-violet-text',
  FOLLOW_UP_DUE: 'bg-warn/15 text-warn-text',
  INTERVIEW_SOON: 'bg-[rgb(var(--magenta-text)/0.15)] text-magenta-text',
  CHECK_DUPLICATE: 'bg-[rgb(var(--orange-text)/0.15)] text-orange-text',
  MONITOR: 'bg-surface-sunken text-ink',
  SKIP: 'bg-danger/15 text-danger-text',
};

export function PriorityBadge({ priority }: { priority: PriorityFlag }) {
  return <span className={`badge ${map[priority]}`}>{priority.replaceAll('_', ' ')}</span>;
}