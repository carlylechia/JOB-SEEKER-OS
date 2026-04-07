import Link from 'next/link';
import { auth } from '@/auth';
import { Logo } from '@/components/shared/logo';
import {
  formatPublicJobAge,
  formatPublicJobLocation,
  getPublicJobs,
} from '@/lib/public-jobs';

type JobsPublicPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function PublicJobsPage({ searchParams }: JobsPublicPageProps) {
  const params = await searchParams;
  const query = params.q?.trim() ?? '';
  const session = await auth();

  const jobs = await getPublicJobs({
    q: query,
    take: 40,
  });

  return (
    <div className="min-h-screen bg-[#050c18] text-ink">
      <div className="shell py-8 sm:py-12">
        <header className="sticky top-0 z-20 rounded-2xl border border-white/10 bg-[#08111f]/70 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[#08111f]/60 sm:px-5">
          <div className="flex items-center justify-between gap-4">
            <Logo href="/" />

            <div className="hidden items-center gap-3 md:flex">
              <Link className="btn-secondary" href="/">
                Back to Home
              </Link>
              {!session ? (
                <>
                  <Link className="btn-secondary" href="/login">
                    Sign In
                  </Link>
                  <Link className="btn-primary" href="/register">
                    Create Account
                  </Link>
                </>
              ) : (
                <Link className="btn-primary" href="/dashboard">
                  Open App
                </Link>
              )}
            </div>
          </div>
        </header>

        <section className="py-14 lg:py-18">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Public Jobs</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Browse recent jobs added across the platform.
            </h1>
            <p className="mt-4 text-base leading-8 text-muted sm:text-lg">
              This page shows jobs added on the platform in the last 30 days. If you sign in, you can bring a relevant job
              into your own workspace and let your own preferences score and prioritize it.
            </p>

            <form className="mt-8 flex flex-col gap-3 sm:flex-row" action="/jobs-public" method="get">
              <input
                type="text"
                name="q"
                defaultValue={query}
                placeholder="Search by title, company, or location"
                className="input flex-1"
              />
              <button type="submit" className="btn-primary">
                Search
              </button>
            </form>
          </div>
        </section>

        <section className="pb-20">
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
                      Recent
                    </span>
                  </div>

                  <div className="mt-5 space-y-2 text-sm text-muted">
                    <p>{formatPublicJobLocation(job.remoteType, job.location)}</p>
                    <p>{formatPublicJobAge(job.createdAt)}</p>
                  </div>

                  {job.notes ? (
                    <p className="mt-5 line-clamp-3 text-sm leading-7 text-slate-200/85">{job.notes}</p>
                  ) : null}

                  <div className="mt-6 flex flex-wrap gap-3">
                    {!session ? (
                      <>
                        <Link className="btn-secondary" href="/login">
                          Sign in to save
                        </Link>
                        <Link className="btn-primary" href="/register">
                          Create account
                        </Link>
                      </>
                    ) : (
                      <Link className="btn-primary" href="/dashboard">
                        Open app to save and score
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[1.6rem] border border-dashed border-white/10 bg-white/5 p-8 text-center">
              <p className="text-lg font-semibold text-ink">No public jobs found</p>
              <p className="mt-3 text-sm leading-7 text-muted">
                Try a different search, or check back as users add more jobs to the platform.
              </p>
            </div>
          )}
        </section>
      </div>

      <footer className="border-t border-white/10 bg-[#06101d]">
        <div className="shell py-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-slate-300">© 2026 Job Seeker OS. All rights reserved.</p>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">
                Job Seeker OS helps users organize and evaluate job opportunities. Users remain responsible for the accuracy of
                their applications, communications, and compliance with the terms of third-party platforms.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link className="btn-secondary" href="/">
                Landing Page
              </Link>
              {!session ? (
                <>
                  <Link className="btn-secondary" href="/login">
                    Sign In
                  </Link>
                  <Link className="btn-primary" href="/register">
                    Create Account
                  </Link>
                </>
              ) : (
                <Link className="btn-primary" href="/dashboard">
                  Open App
                </Link>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}