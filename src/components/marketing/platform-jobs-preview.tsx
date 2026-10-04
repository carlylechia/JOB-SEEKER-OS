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
      <div className="grid gap-8 rounded-[2rem] border border-[#DFE3E9] bg-black/[0.03] p-5 shadow-soft lg:grid-cols-[0.88fr_1.12fr] lg:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A6D1F]">Platform Jobs</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Explore jobs that platform users are actively capturing and working through.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted sm:text-base">
            A few recent opportunities already added on the platform. Browse what is active, save what fits, and move it into
            your own workspace for scoring, prioritization, and execution.
          </p>

          <div className="mt-6 grid gap-3">
            <div className="flex items-start gap-3 rounded-2xl border border-[#DFE3E9] bg-black/[0.03] px-4 py-3">
              <Globe2 className="mt-0.5 h-5 w-5 text-[#8A6D1F]" />
              <p className="text-sm leading-7 text-[#3A4048]">
                A few of the recent jobs being actively captured by users across the platform.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-[#DFE3E9] bg-black/[0.03] px-4 py-3">
              <BookmarkPlus className="mt-0.5 h-5 w-5 text-[#8A6D1F]" />
              <p className="text-sm leading-7 text-[#3A4048]">
                Save any relevant public job into your private workspace and let your own settings determine the fit score.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-[#DFE3E9] bg-black/[0.03] px-4 py-3">
              <Clock3 className="mt-0.5 h-5 w-5 text-[#8A6D1F]" />
              <p className="text-sm leading-7 text-[#3A4048]">
                Stay close to what is active now, not just what you manually discover on your own.
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
                className="rounded-2xl border border-[#DFE3E9] bg-white p-4 shadow-soft transition hover:border-[#D4AF37]/30 hover:bg-black/[0.04]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{job.title}</p>
                    <p className="mt-1 text-sm text-[#4A505A]">{job.company}</p>
                  </div>
                  <span className="rounded-full border border-[#DFE3E9] bg-black/[0.03] px-2.5 py-1 text-[11px] text-muted">
                    Recent
                  </span>
                </div>

                <div className="mt-5 space-y-2 text-sm text-muted">
                  <p>{formatPublicJobLocation(job.remoteType, job.location)}</p>
                  <p>{formatPublicJobAge(job.createdAt)}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="sm:col-span-2 rounded-2xl border border-dashed border-[#DFE3E9] bg-black/[0.02] p-6 text-center">
              <p className="text-sm text-[#3A4048]">No public jobs have been added recently.</p>
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