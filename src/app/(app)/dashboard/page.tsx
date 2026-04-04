'use client';

import Link from 'next/link';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { TopPriorityList } from '@/components/dashboard/top-priority-list';
import { UpcomingList } from '@/components/dashboard/upcoming-list';
import { WeeklyTrendChart } from '@/components/dashboard/weekly-trend-chart';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';

export default function DashboardPage() {
  const { dashboard, jobs, interviews, preferences, onboardingCompleted, isLoading } = useJobs();

  if (isLoading) {
    return <div className="card-pad">Loading your workspace…</div>;
  }

  const followUps = jobs
    .filter((job) => job.nextFollowUp)
    .slice(0, 4)
    .map((job) => ({ label: `${job.company} — ${job.title}`, meta: `Follow up on ${job.nextFollowUp}` }));

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
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-200/85">
                Set your level, target roles, preferred regions, and salary expectations so rankings and future automation reflect
                your actual search. You can also start capturing jobs from links and pasted descriptions in the add-job flow.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/onboarding" className="btn-primary">Complete onboarding</Link>
              <Link href="/jobs/new" className="btn-secondary">Try job ingestion</Link>
            </div>
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
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <WeeklyTrendChart data={dashboard.weeklyTrend} />
        <div className="space-y-6">
          <UpcomingList title="Upcoming follow-ups" items={followUps} />
          <UpcomingList title="Upcoming interviews" items={upcomingInterviews} />
        </div>
      </div>

      <div className="card-pad">
        <div className="text-sm text-muted">Personalized ranking</div>
        <div className="mt-3 text-lg font-semibold">{preferences ? `${preferences.targetLevel} target · ${preferences.preferredRegions.join(' / ')}` : 'Loading preferences...'}</div>
        <div className="mt-2 text-xs text-muted">This release persists onboarding preferences and supports prefilling job leads from parsed links and descriptions.</div>
      </div>

      <TopPriorityList jobs={dashboard.topPriority} />
    </div>
  );
}
