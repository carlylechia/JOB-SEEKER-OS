import {
  ArrowDownRight,
  ArrowUpRight,
  BriefcaseBusiness,
  FileText,
  Flame,
  Minus,
  Target,
} from 'lucide-react';
import type { JobLead, WorkspaceStats } from '@/types';
import { isActiveJobStatus } from '@/lib/job-status';

type Trend = 'up' | 'down' | 'neutral';

type StatsCard = {
  label: string;
  value: number | string;
  suffix?: string;
  icon: typeof BriefcaseBusiness;
  accent: string;
  glow: string;
  trend: Trend;
  trendLabel: string;
  hint: string;
};

const APPLIED_STATUSES = new Set(['APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED']);

function withinLastWeek(value?: string | null): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000;
}

function trendClasses(trend: Trend): string {
  if (trend === 'up') return 'text-success-text';
  if (trend === 'down') return 'text-danger-text';
  return 'text-muted';
}

function TrendIcon({ trend }: { trend: Trend }) {
  if (trend === 'up') return <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />;
  if (trend === 'down') return <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />;
  return <Minus className="h-3.5 w-3.5" aria-hidden />;
}

/**
 * High-impact workspace metrics.
 *
 * `stats` supplies the values that need a database count (tailored resumes and
 * the all-time streak record). Active applications and the interview
 * conversion are derived from the live jobs array so they update immediately
 * after a status change without a full workspace reload.
 */
export function DashboardStats({
  stats,
  jobs,
  currentStreak,
}: {
  stats: WorkspaceStats | null;
  jobs: JobLead[];
  currentStreak: number;
}) {
  const activeJobs = jobs.filter((job) => isActiveJobStatus(job.status));
  const applicationJobs = jobs.filter(
    (job) => Boolean(job.dateApplied) || APPLIED_STATUSES.has(job.status),
  );
  const interviewApplications = applicationJobs.filter(
    (job) =>
      job.interviews.length > 0 || job.status === 'INTERVIEWING' || job.status === 'OFFER',
  );

  const activeApplications = activeJobs.length;
  const activeApplicationsThisWeek = activeJobs.filter((job) =>
    withinLastWeek(job.dateFound),
  ).length;
  const applicationsTracked = applicationJobs.length;
  const interviewsRecorded = interviewApplications.length;
  const interviewSuccessRate =
    applicationsTracked === 0
      ? 0
      : Math.round((interviewsRecorded / applicationsTracked) * 100);

  const tailoredResumes = Math.max(
    stats?.tailoredResumes ?? 0,
    jobs.filter((job) => job.checklist?.resumeTailored).length,
  );
  const tailoredResumesThisWeek = stats?.tailoredResumesThisWeek ?? 0;
  const streakRecord = Math.max(stats?.streakRecord ?? 0, currentStreak);
  const atPersonalBest = currentStreak > 0 && currentStreak >= streakRecord;

  const cards: StatsCard[] = [
    {
      label: 'Active applications',
      value: activeApplications,
      suffix: activeApplications === 1 ? 'role' : 'roles',
      icon: BriefcaseBusiness,
      accent: 'text-accent-text',
      glow: 'bg-accent/15',
      trend: activeApplicationsThisWeek > 0 ? 'up' : 'neutral',
      trendLabel:
        activeApplicationsThisWeek > 0
          ? `+${activeApplicationsThisWeek} this week`
          : `${activeApplications} in pipeline`,
      hint: 'Roles still moving through your active pipeline.',
    },
    {
      label: 'Tailored resumes',
      value: tailoredResumes,
      suffix: tailoredResumes === 1 ? 'resume' : 'resumes',
      icon: FileText,
      accent: 'text-success-text',
      glow: 'bg-success/15',
      trend: tailoredResumesThisWeek > 0 ? 'up' : 'neutral',
      trendLabel:
        tailoredResumesThisWeek > 0
          ? `+${tailoredResumesThisWeek} this week`
          : `${tailoredResumes} generated`,
      hint: 'Bespoke resume variants created for specific roles.',
    },
    {
      label: 'Interview success rate',
      value: `${interviewSuccessRate}%`,
      icon: Target,
      accent: 'text-warn-text',
      glow: 'bg-warn/15',
      trend: interviewSuccessRate > 0 ? 'up' : 'neutral',
      trendLabel: `${interviewsRecorded} of ${applicationsTracked} ${
        applicationsTracked === 1 ? 'application' : 'applications'
      }`,
      hint: 'Applications that progressed to a recorded interview.',
    },
    {
      label: 'Streak record',
      value: streakRecord,
      suffix: streakRecord === 1 ? 'day' : 'days',
      icon: Flame,
      accent: 'text-orange-text',
      glow: 'bg-[rgb(var(--orange-text)/0.16)]',
      trend: atPersonalBest ? 'up' : 'neutral',
      trendLabel: atPersonalBest ? 'Personal best' : `Current run: ${currentStreak}d`,
      hint: 'Your longest uninterrupted daily engagement run.',
    },
  ];

  return (
    <section className="space-y-4" aria-labelledby="dashboard-stats-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">
            Performance snapshot
          </p>
          <h2
            id="dashboard-stats-heading"
            className="mt-1 text-lg font-semibold tracking-tight text-ink"
          >
            Your search in numbers
          </h2>
        </div>
        <p className="text-xs text-muted">Updated from your live workspace</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;

          return (
            <article
              key={card.label}
              className="group relative min-w-0 overflow-hidden rounded-2xl border border-line bg-card p-5 shadow-soft transition-colors hover:border-line-strong"
            >
              <div
                className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl ${card.glow}`}
                aria-hidden
              />

              <div className="relative flex items-start justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  {card.label}
                </span>
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-sunken ${card.accent}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
              </div>

              <div className="relative mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                  {card.value}
                </span>
                {card.suffix && (
                  <span className="text-xs font-medium text-muted">{card.suffix}</span>
                )}
              </div>

              <div className={`relative mt-3 flex items-center gap-1 text-xs font-medium ${trendClasses(card.trend)}`}>
                <TrendIcon trend={card.trend} />
                <span>{card.trendLabel}</span>
              </div>

              <p className="relative mt-2 text-xs leading-5 text-muted">{card.hint}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
