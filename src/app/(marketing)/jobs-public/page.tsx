import Link from 'next/link';
import type { Metadata } from 'next';
import { auth } from '@/auth';
import { Logo } from '@/components/shared/logo';
import { ThemeSwitch } from '@/components/shared/theme-switch';
import { SavePublicJobButton } from '@/components/marketing/save-public-job-button';
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
import { getPublicJobs } from '@/lib/public-jobs';
import { getAppUrl } from '@/lib/site-url';

const appUrl = getAppUrl();

export const metadata: Metadata = {
  title: 'Public Jobs',
  description:
    'Browse fresh remote and global job opportunities from across the web, then save the roles that fit into your private workspace for scoring, tracking, and follow-up.',
  alternates: { canonical: `${appUrl}/jobs-public` },
};

const TIME_RANGES = [
  { label: '10 days', value: '10' },
  { label: '2 weeks', value: '14' },
  { label: '1 month', value: '30' },
  { label: 'Quarter', value: '90' },
  { label: 'All time', value: '0' },
];

const PER_PAGE = 20;

type JobsPublicPageProps = {
  searchParams: Promise<{
    q?: string;
    title?: string;
    days?: string;
    page?: string;
    category?: string;
    remoteType?: string;
    seniority?: string;
    employmentType?: string;
    source?: string;
    minSalary?: string;
    sort?: string;
  }>;
};

export default async function PublicJobsPage({ searchParams }: JobsPublicPageProps) {
  const params = await searchParams;
  const query = params.q?.trim() ?? '';
  const titleFilter = params.title?.trim() ?? '';
  const days = Number(params.days ?? '30');
  const page = Math.max(1, Number(params.page ?? '1'));
  const category = params.category?.trim().toUpperCase() ?? '';
  const remoteType = params.remoteType?.trim().toLowerCase() ?? '';
  const seniority = params.seniority?.trim().toUpperCase() ?? '';
  const employmentType = params.employmentType?.trim().toUpperCase() ?? '';
  const source = params.source?.trim() ?? '';
  const minSalary = params.minSalary?.trim() ?? '';
  const sort = params.sort?.trim() ?? 'newest';
  const session = await auth();

  const { jobs, total, page: currentPage, totalPages, facets } = await getPublicJobs({
    q: query,
    title: titleFilter,
    days,
    take: PER_PAGE,
    page,
    category,
    remoteType,
    seniority,
    employmentType,
    source,
    minSalary: minSalary ? Number(minSalary) : undefined,
    sort: sort === 'oldest' || sort === 'salary' ? sort : 'newest',
    includeFacets: true,
  });

  const hasFilters = Boolean(
    query ||
      titleFilter ||
      category ||
      remoteType ||
      seniority ||
      employmentType ||
      source ||
      minSalary ||
      days !== 30 ||
      sort !== 'newest',
  );

  // Build a URL helper that preserves current filters.
  function filterHref(overrides: Record<string, string | number>) {
    const sp = new URLSearchParams();
    if (query) sp.set('q', query);
    if (titleFilter) sp.set('title', titleFilter);
    if (category) sp.set('category', category);
    if (remoteType) sp.set('remoteType', remoteType);
    if (seniority) sp.set('seniority', seniority);
    if (employmentType) sp.set('employmentType', employmentType);
    if (source) sp.set('source', source);
    if (minSalary) sp.set('minSalary', minSalary);
    if (sort !== 'newest') sp.set('sort', sort);
    sp.set('days', String(days));
    sp.set('page', '1');
    for (const [key, value] of Object.entries(overrides)) {
      if (value === '') {
        sp.delete(key);
      } else {
        sp.set(key, String(value));
      }
    }
    return `/jobs-public?${sp.toString()}`;
  }

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-background text-ink">
      <div className="sticky top-0 z-20 border-b border-line bg-[color:var(--nav-scrim)] backdrop-blur-xl supports-[backdrop-filter]:bg-[color:var(--nav-scrim)]">
        <div className="shell py-3">
          <div className="flex items-center justify-between gap-4">
            <Logo href="/" />
            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeSwitch size="sm" />
              <div className="hidden items-center gap-3 md:flex">
                <Link className="btn-secondary" href="/">Back to Home</Link>
                {!session ? (
                  <>
                    <Link className="btn-secondary" href="/login">Sign In</Link>
                    <Link className="btn-primary" href="/register">Create Account</Link>
                  </>
                ) : (
                  <Link className="btn-primary" href="/dashboard">Open App</Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="shell py-8 sm:py-12">
        <section className="py-14 lg:py-18">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">Public Jobs</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Fresh roles, automatically collected and community-curated.
            </h1>
            <p className="mt-4 text-base leading-8 text-muted sm:text-lg">
              Browse remote and global jobs from public feeds alongside roles shared by the community. Sign in to
              import any role into your workspace for personalised scoring and tracking.
            </p>
          </div>
        </section>

        {/* Filters */}
        <form className="mb-8 space-y-4" action="/jobs-public" method="get">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Search title, company, location, or skill"
              className="input flex-1"
            />
            <input
              type="text"
              name="title"
              defaultValue={titleFilter}
              placeholder="Filter by job title"
              className="input flex-1"
            />
            <button type="submit" className="btn-primary shrink-0">Search</button>
            {hasFilters && (
              <Link href="/jobs-public" className="btn-secondary shrink-0 text-center">Clear</Link>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <select name="category" defaultValue={category} className="input" aria-label="Category">
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select name="remoteType" defaultValue={remoteType} className="input" aria-label="Work arrangement">
              {PUBLIC_JOB_REMOTE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select name="seniority" defaultValue={seniority} className="input" aria-label="Seniority">
              <option value="">Any seniority</option>
              {facets?.seniorities.map((facet) => (
                <option key={facet.value} value={facet.value}>{facet.label}</option>
              ))}
            </select>
            <select name="employmentType" defaultValue={employmentType} className="input" aria-label="Employment type">
              {PUBLIC_JOB_EMPLOYMENT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select name="source" defaultValue={source} className="input" aria-label="Source">
              <option value="">Any source</option>
              {facets?.sources.map((facet) => (
                <option key={facet.value} value={facet.value}>{facet.label} ({facet.count})</option>
              ))}
            </select>
            <select name="sort" defaultValue={sort} className="input" aria-label="Sort">
              {PUBLIC_JOB_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {TIME_RANGES.map((range) => {
                const active = String(days) === range.value;
                return (
                  <Link
                    key={range.value}
                    href={filterHref({ days: range.value })}
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      active
                        ? 'border-accent/60 bg-accent/15 text-accent-text'
                        : 'border-line bg-surface-sunken text-muted hover:border-line hover:text-ink'
                    }`}
                  >
                    {range.label}
                  </Link>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              Minimum salary
              <input
                type="number"
                name="minSalary"
                min="0"
                step="1000"
                defaultValue={minSalary}
                placeholder="e.g. 60000"
                className="input w-36"
              />
            </label>
            <input type="hidden" name="days" value={String(days)} />
          </div>

          {facets && facets.categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Link
                href={filterHref({ category: '' })}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  !category
                    ? 'border-accent/60 bg-accent/15 text-accent-text'
                    : 'border-line bg-surface-sunken text-muted hover:border-line hover:text-ink'
                }`}
              >
                All categories
              </Link>
              {facets.categories.map((facet) => (
                <Link
                  key={facet.value}
                  href={filterHref({ category: facet.value })}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    category === facet.value
                      ? 'border-accent/60 bg-accent/15 text-accent-text'
                      : 'border-line bg-surface-sunken text-muted hover:border-line hover:text-ink'
                  }`}
                >
                  {facet.label} <span className="text-xs opacity-70">{facet.count}</span>
                </Link>
              ))}
            </div>
          )}
        </form>

        {/* Results count */}
        <p className="mb-5 text-sm text-muted">
          {total === 0
            ? 'No jobs found'
            : `${total} unique job${total === 1 ? '' : 's'} · page ${currentPage} of ${totalPages}`}
        </p>

        <section className="pb-10">
          {jobs.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {jobs.map((job) => {
                const salary = formatPublicJobSalary(job);
                const externalUrl = job.jobUrl || job.attributionUrl;
                return (
                  <article
                    key={job.id}
                    className="flex flex-col rounded-[1.6rem] border border-line bg-surface-sunken p-5 shadow-soft"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-ink">{job.title}</h2>
                        <p className="mt-1 text-sm text-ink-2">{job.company}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-line bg-surface-sunken px-2.5 py-1 text-[11px] text-muted">
                        {formatPublicJobAge(job.postedAt)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent-text">
                        {CATEGORY_LABELS[job.category]}
                      </span>
                      {job.seniority && job.seniority !== 'UNKNOWN' && (
                        <span className="rounded-full border border-line bg-background px-2.5 py-1 text-[11px] text-muted">
                          {formatPublicJobSeniority(job.seniority)}
                        </span>
                      )}
                      {job.employmentType && (
                        <span className="rounded-full border border-line bg-background px-2.5 py-1 text-[11px] text-muted">
                          {formatPublicJobEmploymentType(job.employmentType)}
                        </span>
                      )}
                      {job.sourceType === 'catalog' && job.source && (
                        <span className="rounded-full border border-line bg-background px-2.5 py-1 text-[11px] text-muted">
                          via {formatPublicJobSource(job.source)}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 space-y-1 text-sm text-muted">
                      <p>{formatPublicJobLocation(job.remoteType, job.location)}</p>
                      {salary && <p className="font-medium text-ink-2">{salary}</p>}
                      {job.industry && <p>{job.industry}</p>}
                    </div>

                    {job.skills.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {job.skills.slice(0, 5).map((skill) => (
                          <span
                            key={skill}
                            className="rounded-md border border-line bg-background px-2 py-0.5 text-[11px] text-muted"
                          >
                            {skill}
                          </span>
                        ))}
                        {job.skills.length > 5 && (
                          <span className="px-1 py-0.5 text-[11px] text-muted">+{job.skills.length - 5}</span>
                        )}
                      </div>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
                      <SavePublicJobButton jobId={job.id} isAuthenticated={!!session} />
                      {externalUrl && (
                        <a
                          href={externalUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="btn-secondary text-sm"
                        >
                          View original
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[1.6rem] border border-dashed border-line bg-surface-sunken p-8 text-center">
              <p className="text-lg font-semibold text-ink">No public jobs found</p>
              <p className="mt-3 text-sm leading-7 text-muted">
                Try a different search or adjust the filters. New roles are fetched from public job feeds throughout
                the day.
              </p>
            </div>
          )}
        </section>

        {/* Pagination */}
        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2 pb-16">
            {currentPage > 1 && (
              <Link href={filterHref({ page: currentPage - 1 })} className="btn-secondary">
                ← Previous
              </Link>
            )}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => Math.abs(p - currentPage) <= 2 || p === 1 || p === totalPages)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === '...' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-muted">…</span>
                ) : (
                  <Link
                    key={p}
                    href={filterHref({ page: p })}
                    className={`rounded-xl border px-3 py-1.5 text-sm ${
                      p === currentPage
                        ? 'border-accent/60 bg-accent/15 text-accent-text'
                        : 'border-line bg-surface-sunken text-muted hover:border-line hover:text-ink'
                    }`}
                  >
                    {p}
                  </Link>
                )
              )}
            {currentPage < totalPages && (
              <Link href={filterHref({ page: currentPage + 1 })} className="btn-secondary">
                Next →
              </Link>
            )}
          </nav>
        )}
      </div>

      <footer className="w-full overflow-hidden border-t border-line bg-card pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="shell w-full py-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-ink-2">© 2026 teChia Digital Solutions. teChia Jobs. All rights reserved.</p>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">
                teChia Jobs helps users organise and evaluate job opportunities. Listings are attributed to their
                original sources. Users remain responsible for the accuracy of their applications and compliance with
                third-party platform terms.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link className="btn-secondary" href="/">Landing Page</Link>
              {!session ? (
                <>
                  <Link className="btn-secondary" href="/login">Sign In</Link>
                  <Link className="btn-primary" href="/register">Create Account</Link>
                </>
              ) : (
                <Link className="btn-primary" href="/dashboard">Open App</Link>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
