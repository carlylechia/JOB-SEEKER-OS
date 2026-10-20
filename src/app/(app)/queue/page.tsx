"use client";

import Link from 'next/link';
import useSWR from 'swr';
import { PageHeader } from '@/components/shared/page-header';
import { CareerAction } from '@/types';

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error('Failed to load queue');
    return r.json();
  });

export default function QueuePage() {
  const { data, error, isLoading, mutate } = useSWR<{ actions: CareerAction[] }>('/api/career-actions', fetcher);

  if (isLoading) return <div className="card-pad">Loading your queue…</div>;
  if (error) return <div className="card-pad text-danger-text">Could not load queue.</div>;

  const actions = data?.actions ?? [];

  async function markComplete(id: string) {
    await fetch(`/api/career-actions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' }),
    });
    mutate();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Action Queue" subtitle="Prioritized from your real job-search data." />

      {actions.length === 0 ? (
        <div className="card-pad text-center py-12">
          <div className="text-4xl mb-4">✅</div>
          <div className="text-lg font-semibold">All caught up!</div>
          <div className="muted mt-2">No pending actions. Add more jobs or update existing statuses.</div>
          <Link href="/jobs/new" className="btn-primary mt-4 inline-block">Add a job</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {actions.map((task) => (
            <div key={task.id} className="card-pad border border-line">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted">{task.actionType.replace(/_/g, ' ')}</div>
                  <Link href={task.relatedJobId ? `/jobs/${task.relatedJobId}` : '/queue'} className="mt-1 block font-semibold hover:text-accent-text">
                    {task.title}
                  </Link>
                  <div className="text-sm text-muted">{task.description}</div>
                  {task.dueDate && <div className="text-xs text-danger-text mt-1">Due {new Date(task.dueDate).toLocaleDateString()}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">P{task.priority}</span>
                  <button onClick={() => markComplete(task.id)} className="btn-secondary text-sm">Complete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
