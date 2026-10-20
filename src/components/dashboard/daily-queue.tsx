'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { CareerAction } from '@/types';

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error('Failed to load queue');
    return r.json();
  });

function actionHref(item: CareerAction): string {
  if (item.relatedJobId) return `/jobs/${item.relatedJobId}`;
  if (item.relatedPrepPackId) return '/prep';
  return '/queue';
}

export function DailyQueue() {
  const { data, error, isLoading, mutate } = useSWR<{ actions: CareerAction[] }>(
    '/api/career-actions?limit=8',
    fetcher,
    { revalidateOnFocus: true, dedupingInterval: 5 * 60 * 1000 },
  );

  if (isLoading) {
    return (
      <div className="card-pad space-y-3 animate-pulse">
        <div className="h-4 w-40 rounded bg-surface-sunken" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-surface-sunken" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-pad border border-danger/20 bg-danger/10 text-sm text-danger-text">
        Could not load your daily queue. Try refreshing the page.
      </div>
    );
  }

  const queue = (data?.actions ?? []).filter((a) => a.status === 'PENDING' || a.status === 'IN_PROGRESS');

  if (queue.length === 0) {
    return (
      <div className="card-pad">
        <h2 className="text-lg font-semibold">Your Daily Queue</h2>
        <div className="mt-4 rounded-xl border border-success/20 bg-success/10 px-4 py-6 text-center">
          <div className="text-2xl">🎉</div>
          <p className="mt-2 font-medium text-success-text">All caught up!</p>
          <p className="mt-1 text-sm text-muted">No urgent actions right now. Add more jobs or check back later.</p>
          <div className="mt-4 flex justify-center gap-3">
            <Link href="/jobs/new" className="btn-primary text-sm">Add a job</Link>
            <Link href="/pipeline" className="btn-secondary text-sm">View pipeline</Link>
          </div>
        </div>
      </div>
    );
  }

  async function markComplete(id: string) {
    await fetch(`/api/career-actions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' }),
    });
    mutate();
  }

  return (
    <div className="card-pad space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your Daily Queue</h2>
        <span className="text-xs text-muted">{queue.length} action{queue.length !== 1 ? 's' : ''} today</span>
      </div>

      <div className="space-y-3">
        {queue.map((item) => (
          <div key={item.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between border-line bg-surface">
            <div className="flex min-w-0 gap-3">
              <span className="mt-0.5 text-xl shrink-0" aria-hidden="true">•</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium leading-tight">{item.title}</span>
                  {item.priority >= 90 && (
                    <span className="shrink-0 rounded-full bg-danger/20 px-2 py-0.5 text-xs font-semibold text-danger-text">
                      High priority
                    </span>
                  )}
                  <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-muted">
                    {item.actionType.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted leading-relaxed">{item.description}</p>
                {item.dueDate && (
                  <p className="mt-1 text-xs text-danger-text">Due {new Date(item.dueDate).toLocaleDateString()}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => markComplete(item.id)} className="btn-secondary text-sm">Complete</button>
              <Link href={actionHref(item)} className="btn-secondary text-sm">Open →</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
