'use client';

import Link from 'next/link';
import {
  Briefcase, CheckSquare, Calendar, TrendingUp,
  Star, BarChart2, ArrowRight, Zap, Bell,
  UserCircle, Settings, Clock, ListChecks,
  Mail, BookOpenCheck,
} from 'lucide-react';
import { DailyQueue } from '@/components/dashboard/daily-queue';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { StreakWidget } from '@/components/dashboard/streak-widget';
import { TopPriorityList } from '@/components/dashboard/top-priority-list';
import { UpcomingList } from '@/components/dashboard/upcoming-list';
import { WeeklyTrendChart } from '@/components/dashboard/weekly-trend-chart';
import { useJobs } from '@/hooks/use-job-data';

function getGreeting(name?: string): string {
  const h = new Date().getHours();
  const first = name?.split(' ')[0] ?? '';
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return first ? `${greeting}, ${first}` : greeting;
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

export default function DashboardPage() {
  const { dashboard, jobs, interviews, preferences, onboardingCompleted, onboardingSkipped, profile, streakCount, isLoading } = useJobs();

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 rounded-2xl bg-surface-sunken" />
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-surface-sunken" />)}
        </div>
        <div className="h-64 rounded-2xl bg-surface-sunken" />
      </div>
    );
  }

  // Derive follow-up and interview lists
  const followUpItems = jobs
    .filter((job) => job.nextFollowUp)
    .slice(0, 5)
    .map((job) => {
      const d = new Date(job.nextFollowUp!);
      const today = new Date();
      const isToday = d.toDateString() === today.toDateString();
      const isTomorrow = d.toDateString() === new Date(today.getTime() + 86400000).toDateString();
      const meta = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { label: `${job.company} — ${job.title}`, meta, urgent: isToday || isTomorrow };
    });

  const interviewItems = interviews
    .slice(0, 5)
    .map((item) => {
      const d = new Date(item.scheduledAt);
      const isToday = d.toDateString() === new Date().toDateString();
      const meta = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return { label: `${item.company} — ${item.stage}`, meta, urgent: isToday };
    });

  const hasJobs = jobs.length > 0;

  // Setup actions count
  const setupItems = [
    !onboardingCompleted || onboardingSkipped,
    !profile?.profileCompleted,
  ].filter(Boolean).length;

  const activationSteps = [
    {
      label: 'Complete onboarding',
      done: onboardingCompleted && !onboardingSkipped,
      href: '/onboarding',
      note: 'Set your targets, stack, and location fit.',
    },
    {
      label: 'Finish your profile',
      done: Boolean(profile?.profileCompleted),
      href: '/profile',
      note: 'Add your headline, links, and photo.',
    },
    {
      label: 'Add your first job',
      done: hasJobs,
      href: '/jobs/new',
      note: 'Paste a URL or description to start tracking.',
    },
  ];
  const activationProgress = Math.round(
    (activationSteps.filter((step) => step.done).length / activationSteps.length) * 100,
  );

  return (
    <div className="space-y-6 pb-8">

      {/* ── Hero header ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-r from-surface-sunken via-background to-card px-6 py-6">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/[0.08] blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-32 w-64 rounded-full bg-accent/[0.05] blur-2xl" aria-hidden />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{getGreeting(profile?.fullName)}</h1>
            <p className="mt-1 text-sm text-muted">{getFormattedDate()}</p>
            {hasJobs && preferences && (
              <p className="mt-2 text-xs text-muted">
                Targeting{' '}
                <span className="text-ink-2">
                  {preferences.targetRoles.slice(0, 2).join(' / ') || 'all roles'}
                </span>
                {preferences.remoteOnly && ' · remote only'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/jobs/new" className="btn-primary gap-1.5 text-sm">
              <Zap className="h-3.5 w-3.5" /> Add job
            </Link>
            <Link href="/queue" className="btn-secondary gap-1.5 text-sm">
              <ListChecks className="h-3.5 w-3.5" /> View queue
            </Link>
            <Link href="/interview-prep" className="btn-secondary gap-1.5 text-sm">
              <BookOpenCheck className="h-3.5 w-3.5" /> Interview prep
            </Link>
            <Link href="/pipeline" className="btn-secondary gap-1.5 text-sm">
              <BarChart2 className="h-3.5 w-3.5" /> Pipeline
            </Link>
          </div>
        </div>
      </div>

      {/* ── Setup banners ────────────────────────────────────────────── */}
      {setupItems > 0 && (
        <div className="space-y-3">
          {(!onboardingCompleted || onboardingSkipped) && (
            <div className="flex flex-col gap-4 rounded-2xl border border-accent/20 bg-accent/[0.07] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Settings className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-text" />
                <div>
                  {onboardingSkipped ? (
                    <>
                      <p className="text-sm font-semibold text-accent-text">Your onboarding is incomplete</p>
                      <p className="mt-1 text-xs leading-5 text-ink-2/70">You skipped setup earlier. Resume onboarding to improve your fit scores and personalise your job search experience.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-accent-text">Complete onboarding to improve scoring quality</p>
                      <p className="mt-1 text-xs leading-5 text-ink-2/70">Set your level, job titles, preferred regions, and work-hour overlap so rankings reflect what you actually want.</p>
                    </>
                  )}
                </div>
              </div>
              <Link href="/onboarding" className="btn-primary flex-shrink-0 text-sm">
                {onboardingSkipped ? 'Resume onboarding' : 'Complete onboarding'}
              </Link>
            </div>
          )}

          {!profile?.profileCompleted && (
            <div className="flex flex-col gap-4 rounded-2xl border border-warn/20 bg-warn/[0.07] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <UserCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warn-text" />
                <div>
                  <p className="text-sm font-semibold text-warn-text">Your profile is incomplete</p>
                  <p className="mt-1 text-xs leading-5 text-ink-2/70">Add your name, headline, and portfolio or resume links so your materials are easier to manage.</p>
                </div>
              </div>
              <Link href="/profile" className="btn-primary flex-shrink-0 text-sm">Update profile</Link>
            </div>
          )}
        </div>
      )}

      {/* ── Streak (prominent, only when active) ────────────────────── */}
      {streakCount > 0 && <StreakWidget streakCount={streakCount} />}

      <section className="rounded-2xl border border-line bg-gradient-to-r from-surface-sunken via-background to-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">Activation progress</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">Build momentum in your first week</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-28 overflow-hidden rounded-full bg-surface-base">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong transition-all duration-300"
                style={{ width: `${activationProgress}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-ink">{activationProgress}%</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {activationSteps.map((step) => (
            <Link
              key={step.label}
              href={step.href}
              className={`rounded-2xl border p-4 transition ${
                step.done
                  ? 'border-success/25 bg-success/[0.08] text-success-text'
                  : 'border-line bg-surface-base text-ink hover:border-accent/40'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{step.label}</p>
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                    step.done ? 'bg-success/20 text-success-text' : 'bg-surface-sunken text-muted'
                  }`}
                >
                  {step.done ? '✓' : step.label.charAt(0).toUpperCase()}
                </span>
              </div>
              <p className={`mt-2 text-xs leading-5 ${step.done ? 'text-success-text/80' : 'text-muted'}`}>
                {step.note}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── KPI row ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total leads"  value={dashboard.total}         icon={Briefcase}    accent="text-accent-text" />
        <KpiCard label="Applied"      value={dashboard.applied}       icon={CheckSquare}  accent="text-success-text" />
        <KpiCard label="Interviews"   value={dashboard.interviewsCount} icon={Calendar}   accent="text-muted" />
        <KpiCard label="Offers"       value={dashboard.offers}        icon={Star}         accent="text-warn-text" />
        <KpiCard label="Avg fit score" value={dashboard.avgFit}       icon={TrendingUp}   accent="text-accent-text" />
        <KpiCard label="Response rate" value={`${dashboard.responseRate}%`} icon={BarChart2} accent="text-muted" />
      </div>

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {!hasJobs ? (
        <div className="rounded-2xl border border-line bg-surface-sunken px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface-sunken">
            <Briefcase className="h-6 w-6 text-accent-text" />
          </div>
          <h3 className="text-lg font-semibold text-ink">No jobs in your workspace yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
            Start by pasting a job URL, pasting a description, or manually adding a role. Your dashboard will populate automatically.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/jobs/new" className="btn-primary">Add your first job</Link>
            <Link href="/jobs-public" className="btn-secondary">Browse public jobs</Link>
          </div>
        </div>
      ) : (
        <>
          {/* ── Daily Queue (hero action section) ───────────────────── */}
          <DailyQueue />

          {/* ── Top priorities + upcoming columns ───────────────────── */}
          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <TopPriorityList jobs={dashboard.topPriority} />

            <div className="space-y-4">
              <UpcomingList
                title="Follow-ups"
                items={followUpItems}
                icon={Mail}
                accentColor="text-warn-text"
                emptyText="No follow-ups scheduled."
              />
              <UpcomingList
                title="Upcoming interviews"
                items={interviewItems}
                icon={Calendar}
                accentColor="text-muted"
                emptyText="No interviews scheduled."
              />
            </div>
          </div>

          {/* ── Weekly chart ────────────────────────────────────────── */}
          <WeeklyTrendChart data={dashboard.weeklyTrend} />

          {/* ── Preferences summary ─────────────────────────────────── */}
          {preferences && (
            <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-sunken px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Settings className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted" />
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {preferences.targetLevel} · {preferences.targetRoles.join(' / ') || 'All roles'}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Scoring is based on this preference profile. Title match is the strongest signal — update any time your priorities change.
                  </p>
                </div>
              </div>
              <Link href="/settings" className="btn-secondary flex-shrink-0 gap-1.5 text-sm">
                <Settings className="h-3.5 w-3.5" /> Preferences
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
