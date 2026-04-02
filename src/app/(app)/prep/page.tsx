'use client';

import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';

export default function PrepPage() {
  const { jobs, isLoading } = useJobs();
  if (isLoading) return <div className="card-pad">Loading prep packs…</div>;
  return (
    <div className="space-y-6">
      <PageHeader title="Prep Packs" subtitle="Interview prep, talking points, and company-specific notes." />
      <div className="grid gap-4 lg:grid-cols-2">
        {jobs.map((job) => (
          <div key={job.id} className="card-pad">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{job.company}</div>
                <div className="muted">{job.title}</div>
              </div>
              <span className="badge bg-white/10 text-white">{job.prepPack.prepStatus}</span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-muted">
              <div><span className="text-ink">Why this role:</span> {job.prepPack.whyThisRole || 'Not filled yet.'}</div>
              <div><span className="text-ink">Fit points:</span> {job.prepPack.topFitPoints || 'Not filled yet.'}</div>
              <div><span className="text-ink">Questions:</span> {job.prepPack.questionsToAsk || 'Not filled yet.'}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
