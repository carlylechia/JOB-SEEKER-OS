'use client';

import Link from 'next/link';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { TopPriorityList } from '@/components/dashboard/top-priority-list';
import { UpcomingList } from '@/components/dashboard/upcoming-list';
import { WeeklyTrendChart } from '@/components/dashboard/weekly-trend-chart';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';

export default function DashboardPage() {
  const { dashboard, jobs, interviews, preferences, onboardingCompleted, profile, isLoading } = useJobs();

  if (isLoading) return <div className="card-pad">Loading your workspace…</div>;

  const followUps = jobs.filter((job) => job.nextFollowUp).slice(0, 4).map((job) => ({ label: `${job.company} — ${job.title}`, meta: `Follow up on ${job.nextFollowUp}` }));
  const upcomingInterviews = interviews.slice(0, 4).map((item) => ({ label: `${item.company} — ${item.stage}`, meta: new Date(item.scheduledAt).toLocaleString() }));

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Your current search health, priorities, and next actions." />

      {!onboardingCompleted ? (
        <div className="card-pad border border-sky-400/20 bg-sky-500/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-200">Recommended next step</div>
              <h3 className="mt-2 text-xl font-semibold text-ink">Complete onboarding to improve scoring quality</h3>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-200/85">Set your level, primary job titles, preferred regions, and work-hour overlap so rankings reflect what you actually want.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/onboarding" className="btn-primary">Complete onboarding</Link>
              <Link href="/jobs/new" className="btn-secondary">Try job ingestion</Link>
            </div>
          </div>
        </div>
      ) : null}

      {!profile?.profileCompleted ? (
        <div className="card-pad border border-amber-400/20 bg-amber-500/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">Complete your profile</div>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-200/85">Add your name, headline, and at least one of your portfolio, GitHub, LinkedIn, or resume links so the app feels personal and your materials are easier to manage.</p>
            </div>
            <Link href="/profile" className="btn-primary">Update profile</Link>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Total leads" value={dashboard.total} />
        <KpiCard label="Applied" value={dashboard.applied} />
        <KpiCard label="Interviews" value={dashboard.interviewsCount} />
        <KpiCard label="Offers" value={dashboard.offers} />
        <KpiCard label="Avg fit score" value={dashboard.avgFit} />
        <KpiCard label="Response rate" value={`${dashboard.responseRate}%`} />
      </div>

      {jobs.length === 0 ? (
        <div className="card-pad">
          <h3 className="text-xl font-semibold">No jobs in your workspace yet</h3>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">Your dashboard now only shows jobs you add yourself. Start by pasting a job URL, pasting a description, or manually creating a role.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/jobs/new" className="btn-primary">Add your first job</Link>
            <Link href="/jobs-public" className="btn-secondary">Browse public jobs</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
            <WeeklyTrendChart data={dashboard.weeklyTrend} />
            <div className="space-y-6">
              <UpcomingList title="Upcoming follow-ups" items={followUps} />
              <UpcomingList title="Upcoming interviews" items={upcomingInterviews} />
            </div>
          </div>

          <div className="card-pad">
            <div className="text-sm text-muted">Personalized ranking</div>
            <div className="mt-3 text-lg font-semibold">{preferences ? `${preferences.targetLevel} target · ${preferences.targetRoles.join(' / ') || 'No titles selected yet'}` : 'Loading preferences...'}</div>
            <div className="mt-2 text-xs text-muted">Title match is now the strongest personalization signal. Jobs in your private workspace are still scored even if the title match is weak, but weaker matches receive lower scores.</div>
          </div>

          <TopPriorityList jobs={dashboard.topPriority} />
        </>
      )}
    </div>
  );
}
