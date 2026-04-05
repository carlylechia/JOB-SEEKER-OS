'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { JobLead } from '@/types';

export default function PublicJobsPage() {
  const router = useRouter();
  const { getPublicJobs, savePublicJob, titleOptions } = useJobs();
  const [jobs, setJobs] = useState<JobLead[]>([]);
  const [search, setSearch] = useState('');
  const [titleFilter, setTitleFilter] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading'>('loading');

  useEffect(() => {
    getPublicJobs().then(setJobs).finally(() => setStatus('idle'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => jobs.filter((job) => {
    const query = search.toLowerCase();
    const textMatch = !query || `${job.company} ${job.title} ${job.location}`.toLowerCase().includes(query);
    const titleMatch = !titleFilter || job.title.toLowerCase().includes(titleFilter.toLowerCase());
    return textMatch && titleMatch;
  }), [jobs, search, titleFilter]);

  async function handleSave(jobId: string) {
    try {
      await savePublicJob(jobId);
      router.push('/dashboard');
    } catch {
      router.push(`/login?callbackUrl=${encodeURIComponent('/jobs-public')}`);
    }
  }

  return (
    <div className="shell py-12 space-y-6">
      <PageHeader title="Public Jobs" subtitle="Jobs shared on the platform in the last 30 days. Search, filter, and add a role to your workspace to score it against your settings." />
      <div className="card-pad grid gap-4 md:grid-cols-[1fr_280px]">
        <input className="input" placeholder="Search company, title, or location" value={search} onChange={(e) => setSearch(e.target.value)} />
        <input list="public-job-titles" className="input" placeholder="Filter by title" value={titleFilter} onChange={(e) => setTitleFilter(e.target.value)} />
        <datalist id="public-job-titles">{titleOptions.map((option) => <option key={option} value={option} />)}</datalist>
      </div>
      {status === 'loading' ? <div className="card-pad">Loading recent public jobs…</div> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((job) => (
          <div key={job.id} className="card-pad">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">{job.title}</div>
                <div className="muted mt-1">{job.company} · {job.location || 'Location not specified'}</div>
              </div>
              <span className="badge bg-white/10 text-slate-200">{job.remoteType || 'Role'}</span>
            </div>
            <p className="mt-4 text-sm leading-7 text-muted line-clamp-4">{job.notes || 'No additional notes captured for this listing yet.'}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {job.jobUrl ? <Link href={job.jobUrl} target="_blank" className="btn-secondary">Open source</Link> : null}
              <button className="btn-primary" onClick={() => void handleSave(job.id)}>Add to my workspace</button>
            </div>
          </div>
        ))}
      </div>
      {!status && filtered.length === 0 ? <div className="card-pad">No public jobs matched your filters.</div> : null}
    </div>
  );
}
