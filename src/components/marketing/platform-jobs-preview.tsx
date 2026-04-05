import Link from 'next/link';
import { ArrowRight, BookmarkPlus, Clock3, Globe2 } from 'lucide-react';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';

type PublicJobPreview = {
  id: string;
  title: string;
  company: string;
  remoteType: string | null;
  location: string | null;
  createdAt: Date;
};

const getPublicJobPreview = unstable_cache(
  async (): Promise<PublicJobPreview[]> => {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const jobs = await prisma.jobLead.findMany({
      where: {
        createdAt: {
          gte: since,
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 4,
      select: {
        id: true,
        title: true,
        company: true,
        remoteType: true,
        location: true,
        createdAt: true,
      },
    });

    return jobs;
  },
  ['landing-public-jobs-preview'],
  { revalidate: 300 },
);

function formatAge(date: Date) {
  const now = Date.now();
  const diffDays = Math.max(1, Math.floor((now - new Date(date).getTime()) / (1000 * 60 * 60 * 24)));

  if (diffDays === 1) return 'Added 1 day ago';
  if (diffDays < 7) return `Added ${diffDays} days ago`;

  const weeks = Math.floor(diffDays / 7);
  if (weeks === 1) return 'Added 1 week ago';
  return `Added ${weeks} weeks ago`;
}

function formatLocation(job: PublicJobPreview) {
  if (job.remoteType && job.location) return `${job.remoteType} · ${job.location}`;
  if (job.remoteType) return job.remoteType;
  if (job.location) return job.location;
  return 'Location not specified';
}

export async function PlatformJobsPreview() {
  const jobs = await getPublicJobPreview();

  return (
    <section id="public-jobs" className="py-20 section-fade-up">
      <div className="grid gap-8 rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-soft lg:grid-cols-[0.88fr_1.12fr] lg:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Platform Jobs</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Explore jobs that platform users are actively capturing and working through.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted sm:text-base">
            A few recent opportunities already added on the platform. Browse what is active, save what fits, and move it into
            your own workspace for scoring, prioritization, and execution.
          </p>

          <div className="mt-6 grid gap-3">
            <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <Globe2 className="mt-0.5 h-5 w-5 text-sky-300" />
              <p className="text-sm leading-7 text-slate-200">
                A few of the recent jobs being actively captured by users across the platform.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <BookmarkPlus className="mt-0.5 h-5 w-5 text-sky-300" />
              <p className="text-sm leading-7 text-slate-200">
                Save any relevant public job into your private workspace and let your own settings determine the fit score.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <Clock3 className="mt-0.5 h-5 w-5 text-sky-300" />
              <p className="text-sm leading-7 text-slate-200">
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
                className="rounded-2xl border border-white/10 bg-[#0a1528]/90 p-4 shadow-soft transition hover:border-sky-400/30 hover:bg-[#0c1930]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{job.title}</p>
                    <p className="mt-1 text-sm text-slate-300">{job.company}</p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted">
                    Recent
                  </span>
                </div>

                <div className="mt-5 space-y-2 text-sm text-muted">
                  <p>{formatLocation(job)}</p>
                  <p>{formatAge(job.createdAt)}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="sm:col-span-2 rounded-2xl border border-dashed border-white/10 bg-[#0a1528]/70 p-6 text-center">
              <p className="text-sm text-slate-200">No public jobs have been added recently.</p>
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