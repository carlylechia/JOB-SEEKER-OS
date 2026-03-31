import { JobStatus } from '@/types';

const map: Record<JobStatus, string> = {
  LEAD: 'bg-white/10 text-white',
  SAVED: 'bg-sky-500/15 text-sky-300',
  APPLYING: 'bg-indigo-500/15 text-indigo-300',
  APPLIED: 'bg-emerald-500/15 text-emerald-300',
  INTERVIEWING: 'bg-amber-500/15 text-amber-300',
  OFFER: 'bg-green-500/15 text-green-300',
  REJECTED: 'bg-red-500/15 text-red-300',
  ARCHIVED: 'bg-slate-500/15 text-slate-300',
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge ${map[status]}`}>{status.replace('_', ' ')}</span>;
}
