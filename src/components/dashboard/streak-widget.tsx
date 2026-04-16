'use client';

type Props = {
  streakCount: number;
};

const MILESTONES = [3, 5, 7, 14, 21, 30, 60, 90, 100];

function getMilestoneEmoji(count: number): string {
  if (count >= 100) return '🏆';
  if (count >= 60) return '🚀';
  if (count >= 30) return '💎';
  if (count >= 14) return '🔥';
  if (count >= 7) return '⚡';
  return '🌱';
}

export function StreakWidget({ streakCount }: Props) {
  if (streakCount === 0) return null;

  const nextMilestone = MILESTONES.find((m) => m > streakCount) ?? streakCount + 1;
  const prevMilestone = [...MILESTONES].reverse().find((m) => m <= streakCount) ?? 0;
  const progress = Math.min(100, ((streakCount - prevMilestone) / (nextMilestone - prevMilestone)) * 100);
  const daysLeft = nextMilestone - streakCount;
  const emoji = getMilestoneEmoji(streakCount);

  const labelText =
    streakCount === 1 ? 'Day 1 — great start!' :
    streakCount < 7 ? `${streakCount}-day streak` :
    `${streakCount}-day streak`;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-orange-500/20 bg-gradient-to-r from-orange-500/[0.08] via-amber-500/[0.06] to-transparent p-5">
      {/* Subtle glow */}
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-orange-500/10 blur-2xl" aria-hidden />

      <div className="flex items-center gap-5">
        {/* Big emoji / day count */}
        <div className="flex-shrink-0 text-center">
          <div className="text-3xl leading-none">{emoji}</div>
          <div className="mt-1 text-2xl font-bold text-white leading-none">{streakCount}</div>
          <div className="text-[10px] text-orange-300/70 uppercase tracking-wide">days</div>
        </div>

        {/* Info + bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm font-semibold text-orange-200">{labelText}</span>
            <span className="text-xs text-orange-300/60">
              {daysLeft}d to {nextMilestone} {nextMilestone >= 30 ? '🏆' : ''}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Milestone chips */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {MILESTONES.slice(0, 5).map((m) => (
              <span
                key={m}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold
                  ${streakCount >= m
                    ? 'bg-orange-500/25 text-orange-200'
                    : 'bg-white/5 text-slate-600'}`}
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
