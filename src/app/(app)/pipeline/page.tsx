'use client';

import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';

export default function PipelinePage() {
  const { interviews, isLoading } = useJobs();
  if (isLoading) return <div className="card-pad">Loading pipeline…</div>;
  const grouped = ['VIDEO', 'RECRUITER_CALL', 'TECHNICAL', 'FINAL'].map((stage) => ({ stage, items: interviews.filter((i) => i.stage === stage) }));
  return (
    <div className="space-y-6">
      <PageHeader title="Interview Pipeline" subtitle="See current interviews by stage and prep status." />
      <div className="grid gap-4 lg:grid-cols-4">
        {grouped.map((group) => (
          <div key={group.stage} className="card-pad">
            <h3 className="text-lg font-semibold">{group.stage.replaceAll('_', ' ')}</h3>
            <div className="mt-4 space-y-3">
              {group.items.length ? group.items.map((item) => (
                <div key={item.id} className="rounded-xl border border-line p-3">
                  <div className="font-medium">{item.company}</div>
                  <div className="muted">{item.title}</div>
                  <div className="mt-2 text-xs text-muted">{new Date(item.scheduledAt).toLocaleString()}</div>
                </div>
              )) : <div className="muted">No interviews.</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
