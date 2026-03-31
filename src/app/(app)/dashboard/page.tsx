'use client';

import { KpiCard } from '@/components/dashboard/kpi-card';
import { TopPriorityList } from '@/components/dashboard/top-priority-list';
import { UpcomingList } from '@/components/dashboard/upcoming-list';
import { WeeklyTrendChart } from '@/components/dashboard/weekly-trend-chart';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';

export default function DashboardPage() {
  const { dashboard, jobs, interviews } = useJobs();

  const followUps = jobs
    .filter((job) => job.nextFollowUp)
    .slice(0, 4)
    .map((job) => ({ label: `${job.company} — ${job.title}`, meta: `Follow up on ${job.nextFollowUp}` }));

  const upcomingInterviews = interviews.slice(0, 4).map((item) => ({ label: `${item.company} — ${item.stage}`, meta: new Date(item.scheduledAt).toLocaleString() }));

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Your current search health, priorities, and next actions." />
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
      <TopPriorityList jobs={dashboard.topPriority} />
    </div>
  );
}
