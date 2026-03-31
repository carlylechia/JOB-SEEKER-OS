'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { ScoreBadge } from '@/components/shared/score-badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { useJobs } from '@/hooks/use-job-data';
import { checklistCompletion } from '@/lib/scoring';

export default function JobDetailsPage() {
  const params = useParams<{ id: string }>();
  const { getJob } = useJobs();
  const job = getJob(params.id);

  if (!job) return <div className="card-pad">Job not found.</div>;

  return (
    <div className="space-y-6">
      <PageHeader title={job.title} subtitle={job.company} action={<Link className="btn-secondary" href={job.jobUrl} target="_blank">Open listing</Link>} />
      <div className="flex flex-wrap gap-2">
        <ScoreBadge score={job.score.fitScore} tier={job.score.fitTier} />
        <PriorityBadge priority={job.priorityFlag} />
        <StatusBadge status={job.status} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="card-pad">
            <h3 className="text-lg font-semibold">Role details</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><div className="muted">Source</div><div>{job.source}</div></div>
              <div><div className="muted">Location</div><div>{job.location}</div></div>
              <div><div className="muted">Timezone</div><div>{job.timezoneRequirement}</div></div>
              <div><div className="muted">Eligibility</div><div>{job.eligibilityRegion}</div></div>
              <div><div className="muted">Compensation</div><div>{job.salaryMin} - {job.salaryMax} {job.currency}</div></div>
              <div><div className="muted">Date found</div><div>{job.dateFound}</div></div>
            </div>
          </div>
          <div className="card-pad">
            <h3 className="text-lg font-semibold">Notes</h3>
            <p className="mt-3 text-muted">{job.notes || 'No notes yet.'}</p>
          </div>
          <div className="card-pad">
            <h3 className="text-lg font-semibold">Linked contacts</h3>
            <div className="mt-4 space-y-3">
              {job.contacts.length ? job.contacts.map((contact) => (
                <div key={contact.id} className="rounded-xl border border-line p-3">
                  <div className="font-medium">{contact.name}</div>
                  <div className="muted">{contact.title} · {contact.relationshipType}</div>
                </div>
              )) : <div className="muted">No contacts linked yet.</div>}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="card-pad">
            <h3 className="text-lg font-semibold">Score breakdown</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(job.score).filter(([k]) => !['fitScore','fitTier'].includes(k)).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-line p-3">
                  <div className="muted">{key}</div>
                  <div className="mt-1 text-xl font-semibold">{value}/5</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card-pad">
            <h3 className="text-lg font-semibold">Submission checklist</h3>
            <div className="mt-2 text-sm text-muted">Completion: {checklistCompletion(job)}%</div>
            <div className="mt-4 grid gap-2">
              {Object.entries(job.checklist).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-xl border border-line p-3">
                  <span>{key}</span>
                  <span className={`badge ${value ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white'}`}>{value ? 'Done' : 'Pending'}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card-pad">
            <h3 className="text-lg font-semibold">Prep pack</h3>
            <div className="mt-4 space-y-3 text-sm">
              <div><span className="text-muted">Why this role: </span>{job.prepPack.whyThisRole}</div>
              <div><span className="text-muted">Top fit points: </span>{job.prepPack.topFitPoints}</div>
              <div><span className="text-muted">Technical focus: </span>{job.prepPack.technicalFocus}</div>
              <div><span className="text-muted">Questions to ask: </span>{job.prepPack.questionsToAsk}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
