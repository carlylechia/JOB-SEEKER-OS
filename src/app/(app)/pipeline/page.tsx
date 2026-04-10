'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { ScoreBadge } from '@/components/shared/score-badge';
import { useJobs } from '@/hooks/use-job-data';
import { JobLead, JobStatus } from '@/types';

type Column = {
  key: string;
  label: string;
  statuses: JobStatus[];
  color: string;
};

const COLUMNS: Column[] = [
  { key: 'saved', label: 'Saved', statuses: ['LEAD', 'SAVED'], color: 'border-sky-500/40 bg-sky-500/5' },
  { key: 'applied', label: 'Applied', statuses: ['APPLYING', 'APPLIED'], color: 'border-amber-500/40 bg-amber-500/5' },
  { key: 'interview', label: 'Interview', statuses: ['INTERVIEWING'], color: 'border-violet-500/40 bg-violet-500/5' },
  { key: 'offer', label: 'Offer', statuses: ['OFFER'], color: 'border-emerald-500/40 bg-emerald-500/5' },
  { key: 'rejected', label: 'Rejected', statuses: ['REJECTED', 'ARCHIVED'], color: 'border-white/10 bg-white/3' },
];

const ALL_STATUSES: JobStatus[] = ['LEAD', 'SAVED', 'APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED'];

function JobCard({ job, onMove }: { job: JobLead; onMove: (id: string, status: JobStatus) => void }) {
  const [moving, setMoving] = useState(false);

  async function handleMove(e: React.ChangeEvent<HTMLSelectElement>) {
    setMoving(true);
    try {
      await onMove(job.id, e.target.value as JobStatus);
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white/5 p-3 space-y-2">
      <Link href={`/jobs/${job.id}`} className="block hover:text-accent">
        <div className="font-medium leading-tight">{job.title}</div>
        <div className="text-sm text-muted">{job.company}</div>
      </Link>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ScoreBadge score={job.score.fitScore} tier={job.score.fitTier} />
        <select
          className="input py-0.5 px-2 text-xs h-7 w-auto"
          value={job.status}
          disabled={moving}
          onChange={handleMove}
          aria-label="Move to status"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </div>
      {job.nextFollowUp && (
        <div className="text-xs text-muted">Follow-up: {job.nextFollowUp}</div>
      )}
    </div>
  );
}

export default function PipelinePage() {
  const { jobs, patchStatus, isLoading } = useJobs();

  if (isLoading) return <div className="card-pad">Loading pipeline…</div>;

  const activeJobs = jobs.filter((j) => j.status !== 'ARCHIVED' || COLUMNS.find(c => c.statuses.includes(j.status as JobStatus)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Job Pipeline"
        subtitle="Track every job from first look to final decision."
      />
      <div className="grid gap-4 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const colJobs = activeJobs.filter((j) => col.statuses.includes(j.status as JobStatus));
          return (
            <div key={col.key} className={`rounded-2xl border p-3 ${col.color}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">{col.label}</h3>
                <span className="text-xs text-muted bg-white/10 rounded-full px-2 py-0.5">{colJobs.length}</span>
              </div>
              <div className="space-y-3">
                {colJobs.length ? (
                  colJobs.map((job) => (
                    <JobCard key={job.id} job={job} onMove={patchStatus} />
                  ))
                ) : (
                  <div className="text-xs text-muted py-4 text-center">Empty</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

