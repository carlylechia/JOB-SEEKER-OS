'use client';

import { useCallback, useEffect, useState } from 'react';
import { CATEGORY_LABELS, CATEGORY_OPTIONS } from '@/lib/job-discovery/categories';
import {
  PUBLIC_JOB_EMPLOYMENT_TYPES,
  PUBLIC_JOB_REMOTE_TYPES,
  PUBLIC_JOB_SORT_OPTIONS,
  formatPublicJobAge,
  formatPublicJobEmploymentType,
  formatPublicJobLocation,
  formatPublicJobSalary,
  formatPublicJobSeniority,
  formatPublicJobSource,
} from '@/lib/public-job-filters';
import type { PublicJobsResult } from '@/lib/public-jobs';

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

type Filters = {
  q: string;
  title: string;
  days: number;
  category: string;
  remoteType: string;
  seniority: string;
  employmentType: string;
  source: string;
  minSalary: string;
  sort: string;
};

const DEFAULT_FILTERS: Filters = {
  q: '',
  title: '',
  days: 30,
  category: '',
  remoteType: '',
  seniority: '',
  employmentType: '',
  source: '',
  minSalary: '',
  sort: 'newest',
};

export function PublicJobBrowser({ onImport }: Props) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<PublicJobsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async (active: Filters, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({
        q: active.q,
        title: active.title,
        days: String(active.days),
        category: active.category,
        remoteType: active.remoteType,
        seniority: active.seniority,
        employmentType: active.employmentType,
        source: active.source,
        minSalary: active.minSalary,
        sort: active.sort,
        take: String(PER_PAGE),
        page: String(p),
        facets: '1',
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

  useEffect(() => {
    void fetchJobs(appliedFilters, page);
  }, [appliedFilters, page, fetchJobs]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setAppliedFilters(filters);
  }

  function updateFilter(patch: Partial<Filters>) {
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
    setAppliedFilters((current) => ({ ...current, ...patch }));
  }

  function clearFilters() {
    setPage(1);
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
  }

  async function handleImport(jobId: string) {
    setImportingId(jobId);
    try {
      const res = await fetch(`/api/public-jobs/${encodeURIComponent(jobId)}/save`, { method: 'POST' });
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

  const hasFilters = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="space-y-4">
      {/* Search controls */}
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="input flex-1"
            placeholder="Search title, company, location, or skill"
            value={filters.q}
            onChange={(e) => setFilters((current) => ({ ...current, q: e.target.value }))}
          />
          <input
            className="input flex-1"
            placeholder="Filter by title"
            value={filters.title}
            onChange={(e) => setFilters((current) => ({ ...current, title: e.target.value }))}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={loading}>
            {loading ? 'Loading…' : 'Search'}
          </button>
          {hasFilters && (
            <button type="button" className="btn-secondary shrink-0" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <select
            className="input"
            aria-label="Category"
            value={filters.category}
            onChange={(e) => updateFilter({ category: e.target.value })}
          >
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Work arrangement"
            value={filters.remoteType}
            onChange={(e) => updateFilter({ remoteType: e.target.value })}
          >
            {PUBLIC_JOB_REMOTE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Seniority"
            value={filters.seniority}
            onChange={(e) => updateFilter({ seniority: e.target.value })}
          >
            <option value="">Any seniority</option>
            {result?.facets?.seniorities.map((facet) => (
              <option key={facet.value} value={facet.value}>{facet.label}</option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Employment type"
            value={filters.employmentType}
            onChange={(e) => updateFilter({ employmentType: e.target.value })}
          >
            {PUBLIC_JOB_EMPLOYMENT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Source"
            value={filters.source}
            onChange={(e) => updateFilter({ source: e.target.value })}
          >
            <option value="">Any source</option>
            {result?.facets?.sources.map((facet) => (
              <option key={facet.value} value={facet.value}>{facet.label} ({facet.count})</option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Sort"
            value={filters.sort}
            onChange={(e) => updateFilter({ sort: e.target.value })}
          >
            {PUBLIC_JOB_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                type="button"
                onClick={() => updateFilter({ days: range.value })}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filters.days === range.value
                    ? 'border-accent/60 bg-accent/15 text-accent-text'
                    : 'border-line bg-surface-sunken text-muted hover:border-line hover:text-ink'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            Minimum salary
            <input
              type="number"
              min="0"
              step="1000"
              className="input w-36"
              placeholder="e.g. 60000"
              value={filters.minSalary}
              onChange={(e) => setFilters((current) => ({ ...current, minSalary: e.target.value }))}
              onBlur={() => updateFilter({ minSalary: filters.minSalary })}
            />
          </label>
        </div>

        {result?.facets && result.facets.categories.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => updateFilter({ category: '' })}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                !filters.category
                  ? 'border-accent/60 bg-accent/15 text-accent-text'
                  : 'border-line bg-surface-sunken text-muted hover:border-line hover:text-ink'
              }`}
            >
              All categories
            </button>
            {result.facets.categories.map((facet) => (
              <button
                key={facet.value}
                type="button"
                onClick={() => updateFilter({ category: facet.value })}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filters.category === facet.value
                    ? 'border-accent/60 bg-accent/15 text-accent-text'
                    : 'border-line bg-surface-sunken text-muted hover:border-line hover:text-ink'
                }`}
              >
                {facet.label} <span className="opacity-70">{facet.count}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-text">
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
              const salary = formatPublicJobSalary(job);
              const externalUrl = job.jobUrl || job.attributionUrl;
              return (
                <div
                  key={job.id}
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-sunken px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{job.title}</p>
                    <p className="mt-0.5 truncate text-sm text-ink-2">{job.company}</p>
                    <p className="mt-1 text-xs text-muted">
                      {formatPublicJobLocation(job.remoteType, job.location)}
                      {salary ? ` · ${salary}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-accent-text">
                        {CATEGORY_LABELS[job.category]}
                      </span>
                      {job.seniority && job.seniority !== 'UNKNOWN' && (
                        <span className="rounded-full border border-line bg-background px-2 py-0.5 text-[11px] text-muted">
                          {formatPublicJobSeniority(job.seniority)}
                        </span>
                      )}
                      {job.employmentType && (
                        <span className="rounded-full border border-line bg-background px-2 py-0.5 text-[11px] text-muted">
                          {formatPublicJobEmploymentType(job.employmentType)}
                        </span>
                      )}
                      {job.sourceType === 'catalog' && job.source && (
                        <span className="rounded-full border border-line bg-background px-2 py-0.5 text-[11px] text-muted">
                          via {formatPublicJobSource(job.source)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted">{formatPublicJobAge(job.postedAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    {externalUrl && (
                      <a
                        href={externalUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="btn-secondary text-sm"
                      >
                        View
                      </a>
                    )}
                    {imported ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs text-success-text">
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
