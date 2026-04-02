'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { ScoreBadge } from '@/components/shared/score-badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { useJobs } from '@/hooks/use-job-data';

export default function JobsPage() {
  const { jobs, isLoading } = useJobs();

  if (isLoading) {
    return <div className="card-pad">Loading jobs…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Job Tracker" subtitle="Manage every lead, score the fit, and track what to do next." action={<Link className="btn-primary" href="/jobs/new">Add Job</Link>} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Role</th>
              <th>Fit</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Date found</th>
              <th>Next follow-up</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td className="font-medium">{job.company}</td>
                <td><Link className="hover:text-accent" href={`/jobs/${job.id}`}>{job.title}</Link></td>
                <td><ScoreBadge score={job.score.fitScore} tier={job.score.fitTier} /></td>
                <td><PriorityBadge priority={job.priorityFlag} /></td>
                <td><StatusBadge status={job.status} /></td>
                <td>{job.dateFound}</td>
                <td>{job.nextFollowUp || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
