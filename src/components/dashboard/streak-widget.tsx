'use client';

type Props = {
  streakCount: number;
};

export function StreakWidget({ streakCount }: Props) {
  if (streakCount === 0) return null;

  const label =
    streakCount === 1
      ? 'Day 1 — great start!'
      : streakCount < 7
      ? `${streakCount}-day streak`
      : streakCount < 30
      ? `${streakCount}-day streak 🔥`
      : `${streakCount}-day streak 🚀`;

  // Progress toward next milestone
  const milestones = [3, 5, 7, 14, 21, 30, 60, 90, 100];
  const nextMilestone = milestones.find((m) => m > streakCount) ?? streakCount + 1;
  const prevMilestone = milestones.slice().reverse().find((m) => m <= streakCount) ?? 1;
  const progress = Math.min(100, ((streakCount - prevMilestone) / (nextMilestone - prevMilestone)) * 100);

  return (
    <div className="card-pad flex items-center gap-4">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-2xl">
        🔥
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-orange-300">{label}</span>
          <span className="text-xs text-muted">{nextMilestone - streakCount}d to {nextMilestone}</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full rounded-full bg-white/10">
          <div
            className="h-1.5 rounded-full bg-orange-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
