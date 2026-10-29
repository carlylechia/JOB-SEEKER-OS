/**
 * Pure streak rules.
 *
 * A streak is a run of consecutive *local calendar days* on which the user did
 * something in the app. Merely opening the app counts: the old engine only ran
 * on mutations, so a user could read their dashboard every day for a week and
 * still be told their streak had ended.
 *
 * The rules are deliberately small and pure so they can be tested without a
 * database:
 *   - active today       → keep the count, streak is safe
 *   - active yesterday   → keep the count, streak is at risk today
 *   - older / never      → the run is over (0 until they show up again)
 */

import { addDaysToDateKey, dateKeyInTimeZone } from './calendar';
import { nextStreakMilestone, previousStreakMilestone } from './streak-milestones';

export type StreakSnapshot = {
  /** Effective streak count right now (0 when the run has already been broken). */
  streakCount: number;
  /** True when the user has already been active in their current local day. */
  activeToday: boolean;
  /** True when yesterday was the last active day — one missed day ends the run. */
  isAtRisk: boolean;
  nextMilestone: number;
  previousMilestone: number;
  daysToNextMilestone: number;
  timeZone: string;
  todayKey: string;
  lastActiveKey: string | null;
};

export function deriveStreak(
  streakCount: number,
  lastActiveDate: Date | null,
  at: Date,
  timeZone?: string | null,
): StreakSnapshot {
  const zone = timeZone?.trim() || 'UTC';
  const todayKey = dateKeyInTimeZone(at, zone);
  const lastActiveKey = lastActiveDate ? dateKeyInTimeZone(lastActiveDate, zone) : null;
  const yesterdayKey = addDaysToDateKey(todayKey, -1);

  // `>=` treats a future timestamp (clock skew) as activity today rather than
  // resetting a legitimate streak because a server clock drifted.
  const activeToday = lastActiveKey !== null && lastActiveKey >= todayKey;
  const isAtRisk = lastActiveKey === yesterdayKey;

  const alive = activeToday || isAtRisk;
  const effectiveCount = alive ? Math.max(1, Math.floor(streakCount)) : 0;
  const nextMilestone = nextStreakMilestone(effectiveCount);

  return {
    streakCount: effectiveCount,
    activeToday,
    isAtRisk,
    nextMilestone,
    previousMilestone: previousStreakMilestone(effectiveCount),
    daysToNextMilestone: Math.max(1, nextMilestone - effectiveCount),
    timeZone: zone,
    todayKey,
    lastActiveKey,
  };
}
