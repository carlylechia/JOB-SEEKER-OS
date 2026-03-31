import { PriorityFlag } from '@/types';

const map: Record<PriorityFlag, string> = {
  APPLY_TODAY: 'bg-emerald-500/15 text-emerald-300',
  APPLY_THIS_WEEK: 'bg-blue-500/15 text-blue-300',
  PREPARE_ASSETS: 'bg-violet-500/15 text-violet-300',
  FOLLOW_UP_DUE: 'bg-amber-500/15 text-amber-300',
  INTERVIEW_SOON: 'bg-fuchsia-500/15 text-fuchsia-300',
  CHECK_DUPLICATE: 'bg-orange-500/15 text-orange-300',
  MONITOR: 'bg-white/10 text-white',
  SKIP: 'bg-red-500/15 text-red-300'
};

export function PriorityBadge({ priority }: { priority: PriorityFlag }) {
  return <span className={`badge ${map[priority]}`}>{priority.replaceAll('_', ' ')}</span>;
}
