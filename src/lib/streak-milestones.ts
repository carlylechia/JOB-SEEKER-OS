/**
 * Streak milestones, shared by the server engine and the dashboard widget.
 *
 * Kept free of Prisma so it can be imported from a client component.
 */

export const STREAK_MILESTONES = [3, 5, 7, 14, 21, 30, 60, 90, 100, 180, 365] as const;

/** The next milestone above `streakCount`, or one day beyond it for very long streaks. */
export function nextStreakMilestone(streakCount: number): number {
  return STREAK_MILESTONES.find((milestone) => milestone > streakCount) ?? streakCount + 1;
}

/** The highest milestone already reached, or 0 when none has been reached. */
export function previousStreakMilestone(streakCount: number): number {
  return [...STREAK_MILESTONES].reverse().find((milestone) => milestone <= streakCount) ?? 0;
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
