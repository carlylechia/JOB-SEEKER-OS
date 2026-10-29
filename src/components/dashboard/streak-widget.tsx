'use client';

import {
  nextStreakMilestone,
  previousStreakMilestone,
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

  const nextMilestone = nextStreakMilestone(streakCount);
  const prevMilestone = previousStreakMilestone(streakCount);
  const progress = Math.min(
    100,
    ((streakCount - prevMilestone) / (nextMilestone - prevMilestone)) * 100,
  );
  const daysLeft = Math.max(1, nextMilestone - streakCount);
  const emoji = streakMilestoneEmoji(streakCount);

  const labelText =
    streakCount === 1 ? 'Day 1 — great start!' : `${streakCount}-day streak`;

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
    <div className="relative overflow-hidden rounded-2xl border border-[rgb(var(--orange-text)/0.20)] bg-gradient-to-r from-[rgb(var(--orange-text))]/[0.08] via-warn/[0.06] to-transparent p-5">
      {/* Subtle glow */}
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[rgb(var(--orange-text)/0.10)] blur-2xl" aria-hidden />

      <div className="flex items-center gap-5">
        {/* Big emoji / day count */}
        <div className="flex-shrink-0 text-center">
          <div className="text-3xl leading-none">{emoji}</div>
          <div className="mt-1 text-2xl font-bold text-ink leading-none">{streakCount}</div>
          <div className="text-[10px] text-orange-text/70 uppercase tracking-wide">days</div>
        </div>

        {/* Info + bar */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-sm font-semibold text-orange-text">{labelText}</span>
            <span className="text-xs text-orange-text/60">
              {daysLeft}d to {nextMilestone} {nextMilestone >= 30 ? '🏆' : ''}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[rgb(var(--orange-text))] to-warn transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
              {status.text}
            </span>
            {[3, 5, 7, 14, 21].map((m) => (
              <span
                key={m}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold
                  ${streakCount >= m
                    ? 'bg-[rgb(var(--orange-text)/0.25)] text-orange-text'
                    : 'bg-surface-sunken text-muted'}`}
              >
                {m}d
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
