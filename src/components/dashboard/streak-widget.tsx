'use client';

import {
  getStreakMilestoneProgress,
  nextStreakMilestones,
  streakMilestoneEmoji,
} from '@/lib/streak-milestones';

type Props = {
  streakCount: number;
  /** The user has already been active in their current local day. */
  activeToday?: boolean;
  /** Yesterday was the last active day; today is the day that decides it. */
  isAtRisk?: boolean;
};

export function StreakWidget({ streakCount, activeToday, isAtRisk }: Props) {
  if (streakCount === 0) return null;

  // A single helper owns the target maths so the widget, notifications and
  // digest can never disagree about how far away the next milestone is.
  const progress = getStreakMilestoneProgress(streakCount);
  const { next: nextMilestone, percent, remaining: daysLeft } = progress;
  const emoji = streakMilestoneEmoji(streakCount);

  const labelText =
    streakCount === 1 ? 'Day 1 — great start!' : `Day ${streakCount} — keep building`;

  // Always show the most recently earned milestone followed by the next three
  // targets. This is generated from the shared ladder, so there is no hidden
  // five-day ceiling in the badge row.
  const milestoneChips = Array.from(
    new Set(
      [progress.previous, ...nextStreakMilestones(streakCount, 3)].filter(
        (milestone) => milestone > 0,
      ),
    ),
  ).slice(0, 4);

  const status = isAtRisk
    ? {
        text: 'At risk — one move today keeps it alive',
        className: 'bg-danger/15 text-danger-text',
      }
    : activeToday
      ? {
          text: 'Today counts — streak secured',
          className: 'bg-success/15 text-success-text',
        }
      : {
          text: 'Keep the momentum going',
          className: 'bg-surface-sunken text-muted',
        };

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[rgb(var(--orange-text)/0.20)] bg-gradient-to-r from-[rgb(var(--orange-text))]/[0.08] via-warn/[0.06] to-transparent p-5"
      aria-live="polite"
    >
      {/* Subtle glow */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[rgb(var(--orange-text)/0.10)] blur-2xl"
        aria-hidden
      />

      <div className="flex items-center gap-5">
        {/* Big emoji / day count */}
        <div className="flex-shrink-0 text-center">
          <div className="text-3xl leading-none">{emoji}</div>
          <div className="mt-1 text-2xl font-bold leading-none text-ink">{streakCount}</div>
          <div className="text-[10px] uppercase tracking-wide text-orange-text/70">
            {streakCount === 1 ? 'day' : 'days'}
          </div>
        </div>

        {/* Info + bar */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-orange-text">{labelText}</span>
            <span className="text-xs text-orange-text/60">
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} to {nextMilestone}
            </span>
          </div>

          {/* Progress bar */}
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-label={`Progress toward the ${nextMilestone}-day streak milestone`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[rgb(var(--orange-text))] to-warn transition-all duration-700"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}
            >
              {status.text}
            </span>
            {milestoneChips.map((milestone) => (
              <span
                key={milestone}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  streakCount >= milestone
                    ? 'bg-[rgb(var(--orange-text)/0.25)] text-orange-text'
                    : 'bg-surface-sunken text-muted'
                }`}
              >
                {milestone}d
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
