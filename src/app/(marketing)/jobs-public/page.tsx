import Link from 'next/link';
import { auth } from '@/auth';
import { Logo } from '@/components/shared/logo';
import { SavePublicJobButton } from '@/components/marketing/save-public-job-button';
import {
  formatPublicJobAge,
  formatPublicJobLocation,
  getPublicJobs,
} from '@/lib/public-jobs';

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
  }>;
};

export default async function PublicJobsPage({ searchParams }: JobsPublicPageProps) {
  const params = await searchParams;
  const query = params.q?.trim() ?? '';
  const titleFilter = params.title?.trim() ?? '';
  const days = Number(params.days ?? '30');
  const page = Math.max(1, Number(params.page ?? '1'));
  const session = await auth();

  const { jobs, total, totalPages } = await getPublicJobs({
    q: query,
    title: titleFilter,
    days,
    take: PER_PAGE,
    page,
  });

  // Build a URL helper that preserves current filters
  function filterHref(overrides: Record<string, string | number>) {
    const sp = new URLSearchParams();
    if (query) sp.set('q', query);
    if (titleFilter) sp.set('title', titleFilter);
    sp.set('days', String(days));
    sp.set('page', '1');
    for (const [k, v] of Object.entries(overrides)) {
      sp.set(k, String(v));
    }
    return `/jobs-public?${sp.toString()}`;
  }

  return (
    <div className="min-h-screen bg-[#050c18] text-ink">
      <div className="shell py-8 sm:py-12">
        <header className="sticky top-0 z-20 rounded-2xl border border-white/10 bg-[#08111f]/70 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[#08111f]/60 sm:px-5">
          <div className="flex items-center justify-between gap-4">
            <Logo href="/" />
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
        </header>

        <section className="py-14 lg:py-18">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Public Jobs</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Browse jobs added across the platform.
            </h1>
            <p className="mt-4 text-base leading-8 text-muted sm:text-lg">
              Jobs contributed by the community. Sign in to import any role into your workspace for personalised scoring and tracking.
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
              placeholder="Search company or location"
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
            {(query || titleFilter || days !== 30) && (
              <Link href="/jobs-public" className="btn-secondary shrink-0 text-center">Clear</Link>
            )}
          </div>
          {/* Time range pills */}
          <div className="flex flex-wrap gap-2">
            {TIME_RANGES.map((range) => {
              const active = String(days) === range.value;
              return (
                <Link
                  key={range.value}
                  href={filterHref({ days: range.value })}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    active
                      ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
                      : 'border-white/10 bg-white/5 text-muted hover:border-white/20 hover:text-ink'
                  }`}
                >
                  {range.label}
                </Link>
              );
            })}
            <input type="hidden" name="days" value={String(days)} />
          </div>
        </form>

        {/* Results count */}
        <p className="mb-5 text-sm text-muted">
          {total === 0
            ? 'No jobs found'
            : `${total} unique job${total === 1 ? '' : 's'} · page ${page} of ${totalPages}`}
        </p>

        <section className="pb-10">
          {jobs.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5 shadow-soft"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-ink">{job.title}</p>
                      <p className="mt-1 text-sm text-slate-300">{job.company}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted">
                      {formatPublicJobAge(job.createdAt)}
                    </span>
                  </div>

                  <div className="mt-4 text-sm text-muted">
                    <p>{formatPublicJobLocation(job.remoteType, job.location)}</p>
                  </div>

                  {job.notes ? (
                    <p className="mt-4 line-clamp-3 text-sm leading-7 text-slate-200/85">{job.notes}</p>
                  ) : null}

                  <div className="mt-6 flex flex-wrap gap-3">
                    <SavePublicJobButton jobId={job.id} isAuthenticated={!!session} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[1.6rem] border border-dashed border-white/10 bg-white/5 p-8 text-center">
              <p className="text-lg font-semibold text-ink">No public jobs found</p>
              <p className="mt-3 text-sm leading-7 text-muted">
                Try a different search or adjust the time range filter.
              </p>
            </div>
          )}
        </section>

        {/* Pagination */}
        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2 pb-16">
            {page > 1 && (
              <Link href={filterHref({ page: page - 1 })} className="btn-secondary">
                ← Previous
              </Link>
            )}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === totalPages)
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
                      p === page
                        ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
                        : 'border-white/10 bg-white/5 text-muted hover:border-white/20 hover:text-ink'
                    }`}
                  >
                    {p}
                  </Link>
                )
              )}
            {page < totalPages && (
              <Link href={filterHref({ page: page + 1 })} className="btn-secondary">
                Next →
              </Link>
            )}
          </nav>
        )}
      </div>

      <footer className="border-t border-white/10 bg-[#06101d]">
        <div className="shell py-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-slate-300">© 2026 Job Seeker OS. All rights reserved.</p>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">
                Job Seeker OS helps users organise and evaluate job opportunities. Users remain responsible for the accuracy of
                their applications and compliance with third-party platform terms.
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
