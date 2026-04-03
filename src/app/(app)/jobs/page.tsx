'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { ScoreBadge } from '@/components/shared/score-badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { useJobs } from '@/hooks/use-job-data';

export default function JobsPage() {
  const { jobs, isLoading } = useJobs();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL');

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesQuery = `${job.company} ${job.title} ${job.notes}`.toLowerCase().includes(query.toLowerCase());
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && !['ARCHIVED', 'REJECTED'].includes(job.status)) ||
        (statusFilter === 'ARCHIVED' && ['ARCHIVED', 'REJECTED'].includes(job.status));
      return matchesQuery && matchesStatus;
    });
  }, [jobs, query, statusFilter]);

  if (isLoading) {
    return <div className="card-pad">Loading jobs…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Job Tracker" subtitle="Manage every lead, score the fit, and track what to do next." action={<Link className="btn-primary" href="/jobs/new">Add Job</Link>} />
      <div className="card-pad flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1"><input className="input" placeholder="Search company, role, or notes..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="flex gap-2">
          {(['ALL', 'ACTIVE', 'ARCHIVED'] as const).map((value) => (
            <button key={value} type="button" className={`btn-secondary ${statusFilter === value ? 'border-accent text-white' : ''}`} onClick={() => setStatusFilter(value)}>{value}</button>
          ))}
        </div>
      </div>
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
            {filteredJobs.map((job) => (
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
