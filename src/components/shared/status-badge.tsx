import { JobStatus } from '@/types';

const map: Record<JobStatus, string> = {
  LEAD: 'bg-black/[0.05] text-[#17191E]',
  SAVED: 'bg-[#D4AF37]/15 text-[#8A6D1F]',
  APPLYING: 'bg-[#C9CED6]/40 text-[#3A4048]',
  APPLIED: 'bg-emerald-500/15 text-emerald-800',
  INTERVIEWING: 'bg-amber-500/15 text-amber-800',
  OFFER: 'bg-green-500/15 text-green-300',
  REJECTED: 'bg-red-500/15 text-red-700',
  ARCHIVED: 'bg-[#686F7B]/10 text-[#4A505A]',
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge ${map[status]}`}>{status.replace('_', ' ')}</span>;
}
