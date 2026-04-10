'use client';

import { useCallback, useEffect, useState } from 'react';
import { PublicJobRecord, PublicJobsResult } from '@/lib/public-jobs';

type Props = {
  onImport: (jobId: string) => void;
};

const TIME_RANGES = [
  { label: '10d', value: 10 },
  { label: '2w', value: 14 },
  { label: '1mo', value: 30 },
  { label: 'Quarter', value: 90 },
  { label: 'All', value: 0 },
];

const PER_PAGE = 10;

export function PublicJobBrowser({ onImport }: Props) {
  const [query, setQuery] = useState('');
  const [titleFilter, setTitleFilter] = useState('');
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<PublicJobsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async (q: string, title: string, d: number, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({
        q,
        title,
        days: String(d),
        take: String(PER_PAGE),
        page: String(p),
      });
      const res = await fetch(`/api/public-jobs?${sp.toString()}`);
      if (!res.ok) throw new Error('Failed to load jobs');
      const data: PublicJobsResult = await res.json();
      setResult(data);
    } catch {
      setError('Could not load public jobs. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Trigger on mount and when filters change
  useEffect(() => {
    void fetchJobs(query, titleFilter, days, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, page]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    void fetchJobs(query, titleFilter, days, 1);
  }

  async function handleImport(jobId: string) {
    setImportingId(jobId);
    try {
      const res = await fetch(`/api/public-jobs/${jobId}/save`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data?.jobId) throw new Error('Import failed');
      setImportedIds((prev) => new Set([...prev, jobId]));
      onImport(data.jobId);
    } catch {
      setError('Failed to import job. Please try again.');
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Search controls */}
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="input flex-1"
            placeholder="Search company or location"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <input
            className="input flex-1"
            placeholder="Filter by title"
            value={titleFilter}
            onChange={(e) => setTitleFilter(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={loading}>
            {loading ? 'Loading…' : 'Search'}
          </button>
        </div>
        {/* Time range pills */}
        <div className="flex flex-wrap gap-2">
          {TIME_RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => { setDays(r.value); setPage(1); }}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                days === r.value
                  ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
                  : 'border-white/10 bg-white/5 text-muted hover:border-white/20 hover:text-ink'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          <p className="text-xs text-muted">
            {result.total === 0
              ? 'No jobs found'
              : `${result.total} unique job${result.total === 1 ? '' : 's'} · page ${result.page} of ${result.totalPages}`}
          </p>

          <div className="space-y-3">
            {result.jobs.map((job) => {
              const imported = importedIds.has(job.id);
              const isImporting = importingId === job.id;
              return (
                <div
                  key={job.id}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{job.title}</p>
                    <p className="mt-0.5 truncate text-sm text-slate-300">{job.company}</p>
                    <p className="mt-1 text-xs text-muted">
                      {[job.remoteType, job.location].filter(Boolean).join(' · ') || 'Location not specified'}
                    </p>
                    {job.notes && (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{job.notes}</p>
                    )}
                  </div>
                  <div className="shrink-0 pt-0.5">
                    {imported ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                        ✓ Added
                      </span>
                    ) : (
                      <button
                        className="btn-primary text-sm"
                        onClick={() => void handleImport(job.id)}
                        disabled={isImporting}
                      >
                        {isImporting ? 'Adding…' : 'Add to workspace'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {result.totalPages > 1 && (
            <div className="flex items-center gap-2 pt-2">
              <button
                className="btn-secondary text-sm"
                disabled={result.page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Prev
              </button>
              <span className="text-sm text-muted">
                {result.page} / {result.totalPages}
              </span>
              <button
                className="btn-secondary text-sm"
                disabled={result.page >= result.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
