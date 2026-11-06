/**
 * Streak milestones, shared by the server engine and the dashboard widget.
 *
 * Kept free of Prisma so it can be imported from a client component.
 *
 * The written ladder is only the start of the sequence. Once a user passes the
 * final scheduled milestone we keep generating targets on a fixed 100-day
 * cadence instead of clamping, so a 400-day streak still has a real next goal.
 */

export const STREAK_MILESTONES = [3, 5, 7, 14, 21, 30, 60, 90, 100, 180, 365] as const;

const FINAL_SCHEDULED_MILESTONE = STREAK_MILESTONES[STREAK_MILESTONES.length - 1];
const POST_LADDER_STEP = 100;

/** Coerce arbitrary input into a usable, non-negative whole number of days. */
function normaliseStreakCount(streakCount: number): number {
  if (!Number.isFinite(streakCount)) return 0;
  return Math.max(0, Math.floor(streakCount));
}

/**
 * The next milestone strictly above `streakCount`.
 *
 * Beyond the written ladder the sequence continues at 365, 465, 565, … so the
 * value is always greater than the current streak and can never be mistaken for
 * a five-day cap.
 */
export function nextStreakMilestone(streakCount: number): number {
  const current = normaliseStreakCount(streakCount);

  const scheduled = STREAK_MILESTONES.find((milestone) => milestone > current);
  if (scheduled !== undefined) return scheduled;

  const stepsBeyond =
    Math.floor((current - FINAL_SCHEDULED_MILESTONE) / POST_LADDER_STEP) + 1;
  return FINAL_SCHEDULED_MILESTONE + stepsBeyond * POST_LADDER_STEP;
}

/** The highest milestone already reached, or 0 when none has been reached. */
export function previousStreakMilestone(streakCount: number): number {
  const current = normaliseStreakCount(streakCount);

  const scheduled = [...STREAK_MILESTONES]
    .reverse()
    .find((milestone) => milestone <= current);
  if (scheduled === undefined) return 0;

  // Keep previous/next consistent once we are on the post-365 cadence.
  if (scheduled !== FINAL_SCHEDULED_MILESTONE) return scheduled;

  const stepsBeyond = Math.floor((current - FINAL_SCHEDULED_MILESTONE) / POST_LADDER_STEP);
  return FINAL_SCHEDULED_MILESTONE + stepsBeyond * POST_LADDER_STEP;
}

/** True when the current streak is an exact milestone worth celebrating. */
export function isStreakMilestone(streakCount: number): boolean {
  const current = normaliseStreakCount(streakCount);
  if (current <= 0) return false;
  if ((STREAK_MILESTONES as readonly number[]).includes(current)) return true;

  return (
    current > FINAL_SCHEDULED_MILESTONE &&
    (current - FINAL_SCHEDULED_MILESTONE) % POST_LADDER_STEP === 0
  );
}

/** The next `limit` milestones after the current streak. */
export function nextStreakMilestones(streakCount: number, limit = 3): number[] {
  const safeLimit = Math.max(0, Math.min(10, Math.floor(limit)));
  const milestones: number[] = [];
  let cursor = normaliseStreakCount(streakCount);

  for (let index = 0; index < safeLimit; index += 1) {
    const milestone = nextStreakMilestone(cursor);
    milestones.push(milestone);
    cursor = milestone;
  }

  return milestones;
}

export type StreakMilestoneProgress = {
  current: number;
  previous: number;
  next: number;
  /** Days still needed to reach `next` (never negative). */
  remaining: number;
  /** Progress from `previous` to `next`, clamped to 0–100. */
  percent: number;
};

/**
 * A single source of truth for streak progress, used by both the dashboard
 * widget and notification copy so they can never disagree about the target.
 */
export function getStreakMilestoneProgress(streakCount: number): StreakMilestoneProgress {
  const current = normaliseStreakCount(streakCount);
  const previous = previousStreakMilestone(current);
  const next = nextStreakMilestone(current);
  const span = Math.max(1, next - previous);

  return {
    current,
    previous,
    next,
    remaining: Math.max(0, next - current),
    percent: Math.min(100, Math.max(0, ((current - previous) / span) * 100)),
  };
}

export function streakMilestoneEmoji(streakCount: number): string {
  if (streakCount >= 365) return '🏆';
  if (streakCount >= 100) return '👑';
  if (streakCount >= 60) return '🚀';
  if (streakCount >= 30) return '💎';
  if (streakCount >= 14) return '🔥';
  if (streakCount >= 7) return '⚡';
  return '🌱';
}
