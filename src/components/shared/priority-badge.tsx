import { PriorityFlag } from '@/types';

const map: Record<PriorityFlag, string> = {
  APPLY_TODAY: 'bg-emerald-500/15 text-emerald-800',
  APPLY_THIS_WEEK: 'bg-[#C9CED6]/40 text-[#4A505A]',
  PREPARE_ASSETS: 'bg-[#C9CED6]/30 text-[#5B6472]',
  FOLLOW_UP_DUE: 'bg-amber-500/15 text-amber-800',
  INTERVIEW_SOON: 'bg-fuchsia-500/15 text-fuchsia-300',
  CHECK_DUPLICATE: 'bg-orange-500/15 text-orange-300',
  MONITOR: 'bg-black/[0.05] text-[#17191E]',
  SKIP: 'bg-red-500/15 text-red-700'
};

export function PriorityBadge({ priority }: { priority: PriorityFlag }) {
  return <span className={`badge ${map[priority]}`}>{priority.replaceAll('_', ' ')}</span>;
}
