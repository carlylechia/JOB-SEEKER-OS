'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { QueueItem } from '@/lib/queue-engine';

// ─── Fetcher ─────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error('Failed to load queue');
    return r.json();
  });

// ─── Visual config ────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  QueueItem['type'],
  { icon: string; color: string; label: string }
> = {
  follow_up: { icon: '📬', color: 'border-amber-500/40 bg-amber-500/5',  label: 'Follow-up' },
  prep:      { icon: '📋', color: 'border-violet-500/40 bg-violet-500/5', label: 'Prep'      },
  apply:     { icon: '📤', color: 'border-sky-500/40 bg-sky-500/5',       label: 'Apply'     },
  stale:     { icon: '🕰️',  color: 'border-white/10 bg-white/5',           label: 'Stale'     },
  review:    { icon: '🔍', color: 'border-orange-500/40 bg-orange-500/5', label: 'Review'    },
};

const CTA_LABELS: Record<QueueItem['cta'], string> = {
  apply:    'Apply now →',
  job:      'View job →',
  prep:     'Open prep →',
  contacts: 'View contacts →',
};

function ctaHref(item: QueueItem): string {
  if (item.cta === 'prep') return '/prep';
  if (item.cta === 'contacts') return `/jobs/${item.jobId}#contacts`;
  return `/jobs/${item.jobId}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DailyQueue() {
  const { data, error, isLoading } = useSWR<{ queue: QueueItem[] }>(
    '/api/queue',
    fetcher,
    {
      // Re-fetch when window regains focus; cache for 5 minutes
      revalidateOnFocus: true,
      dedupingInterval: 5 * 60 * 1000,
    },
  );

  if (isLoading) {
    return (
      <div className="card-pad space-y-3 animate-pulse">
        <div className="h-4 w-40 rounded bg-white/10" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-pad border border-red-500/20 bg-red-500/5 text-sm text-red-300">
        Could not load your daily queue. Try refreshing the page.
      </div>
    );
  }

  const queue = data?.queue ?? [];

  if (queue.length === 0) {
    return (
      <div className="card-pad">
        <h2 className="text-lg font-semibold">Your Daily Queue</h2>
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-6 text-center">
          <div className="text-2xl">🎉</div>
          <p className="mt-2 font-medium text-emerald-300">All caught up!</p>
          <p className="mt-1 text-sm text-muted">No urgent actions right now. Add more jobs or check back later.</p>
          <div className="mt-4 flex justify-center gap-3">
            <Link href="/jobs/new" className="btn-primary text-sm">Add a job</Link>
            <Link href="/pipeline" className="btn-secondary text-sm">View pipeline</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-pad space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your Daily Queue</h2>
        <span className="text-xs text-muted">{queue.length} action{queue.length !== 1 ? 's' : ''} today</span>
      </div>

      <div className="space-y-3">
        {queue.map((item) => {
          const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.review;
          return (
            <div
              key={item.id}
              className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between ${cfg.color}`}
            >
              <div className="flex min-w-0 gap-3">
                <span className="mt-0.5 text-xl shrink-0" aria-hidden="true">{cfg.icon}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium leading-tight">{item.title}</span>
                    {item.isHighPriority && (
                      <span className="shrink-0 rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-300">
                        🔥 High priority
                      </span>
                    )}
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-muted capitalize">
                      {cfg.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted leading-relaxed">{item.description}</p>
                </div>
              </div>
              <Link
                href={ctaHref(item)}
                className="btn-secondary shrink-0 self-start text-sm whitespace-nowrap"
              >
                {CTA_LABELS[item.cta]}
              </Link>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted">Queue refreshes when you return to this tab · Max 5 items shown</p>
    </div>
  );
}
