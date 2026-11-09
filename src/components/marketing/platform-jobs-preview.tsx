import Link from 'next/link';
import { ArrowRight, BookmarkPlus, Clock3, Globe2 } from 'lucide-react';
import { unstable_cache } from 'next/cache';
import {
  formatPublicJobAge,
  formatPublicJobLocation,
  getPublicJobs,
  type PublicJobRecord,
} from '@/lib/public-jobs';

const getCachedPublicJobPreview = unstable_cache(
  async (): Promise<PublicJobRecord[]> => {
    try {
      const result = await getPublicJobs({ take: 4 });
      return result.jobs;
    } catch {
      return [];
    }
  },
  ['landing-public-jobs-preview'],
  { revalidate: 300 },
);

export async function PlatformJobsPreview() {
  const jobs = await getCachedPublicJobPreview();

  return (
    <section id="public-jobs" className="py-20 section-fade-up">
      <div className="grid gap-8 rounded-[2rem] border border-line bg-surface-sunken p-5 shadow-soft lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">Public Jobs</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Recent jobs from several top job boards, across industries and time zones.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted sm:text-base">
            Browse roles posted recently and collected from several top job boards, spanning a range of industries,
            locations, and time zones. Save any role to your workspace for personalised scoring, tracking, and follow-up.
          </p>

          <div className="mt-6 grid gap-3">
            <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface-sunken px-4 py-3">
              <Globe2 className="mt-0.5 h-5 w-5 text-accent-text" />
              <p className="text-sm leading-7 text-ink-2">
                Jobs gathered from several top job boards and refreshed regularly.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface-sunken px-4 py-3">
              <BookmarkPlus className="mt-0.5 h-5 w-5 text-accent-text" />
              <p className="text-sm leading-7 text-ink-2">
                Save any relevant public job into your private workspace and let your own settings determine the fit score.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface-sunken px-4 py-3">
              <Clock3 className="mt-0.5 h-5 w-5 text-accent-text" />
              <p className="text-sm leading-7 text-ink-2">
                Recent postings across industries, locations, and time zones, so there is always something current to review.
              </p>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link className="btn-primary gap-2" href="/jobs-public">
              View more public jobs
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {jobs.length > 0 ? (
            jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-2xl border border-line bg-white p-4 shadow-soft transition hover:border-accent/30 hover:bg-surface-sunken"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{job.title}</p>
                    <p className="mt-1 text-sm text-ink-2">{job.company}</p>
                  </div>
                  <span className="rounded-full border border-line bg-surface-sunken px-2.5 py-1 text-[11px] text-muted">
                    Recent
                  </span>
                </div>

                <div className="mt-5 space-y-2 text-sm text-muted">
                  <p>{formatPublicJobLocation(job.remoteType, job.location)}</p>
                  <p>{formatPublicJobAge(job.postedAt)}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="sm:col-span-2 rounded-2xl border border-dashed border-line bg-surface-sunken p-6 text-center">
              <p className="text-sm text-ink-2">No public jobs have been added recently.</p>
              <p className="mt-2 text-sm text-muted">
                As users add jobs to the platform, a few recent ones will appear here automatically.
              </p>
              <div className="mt-5">
                <Link className="btn-secondary" href="/jobs-public">
                  Visit public jobs page
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}