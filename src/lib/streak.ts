/**
 * Streak engine — reward daily engagement, not just database mutations.
 *
 * Call `touchStreak(userId)` whenever the user is actually using the app
 * (opening a protected page, loading the workspace, heartbeating from the
 * shell) as well as after meaningful actions. A visit is enough to keep a
 * streak alive; the old implementation only counted writes, so a user who read
 * their dashboard every day was treated as inactive.
 *
 * Rules:
 *   - Same local calendar day → unchanged (idempotent)
 *   - Yesterday              → streakCount += 1
 *   - Older OR no date       → streakCount = 1 (start fresh)
 *
 * Calendar days use the user's saved timezone, not UTC. See `streak-core.ts`.
 */

import { prisma } from '@/lib/prisma';
import { now } from '@/lib/billing/clock';
import { createNotification, notificationExistsOnLocalDay } from '@/lib/notifications';
import { logImportantInfo } from '@/lib/observability';
import { deriveStreak, type StreakSnapshot } from './streak-core';
import { STREAK_MILESTONES } from './streak-milestones';

export type TouchStreakResult = StreakSnapshot & { changed: boolean };

type StreakUser = {
  streakCount: number;
  lastActiveDate: Date | null;
  profile: { timezone: string } | null;
};

async function loadStreakUser(userId: string): Promise<StreakUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      streakCount: true,
      lastActiveDate: true,
      profile: { select: { timezone: true } },
    },
  });
}

/**
 * Records activity for the user's current local day and advances the streak
 * when yesterday was the previous active day.
 *
 * Idempotent: calling it on every page load and every heartbeat is safe.
 */
export async function touchStreak(
  userId: string,
  options: { at?: Date } = {},
): Promise<TouchStreakResult> {
  const at = options.at ?? now();
  const user = await loadStreakUser(userId);
  if (!user) {
    return { ...deriveStreak(0, null, at, 'UTC'), changed: false };
  }

  const timeZone = user.profile?.timezone;
  const snapshot = deriveStreak(user.streakCount, user.lastActiveDate, at, timeZone);

  // Already counted today. Repair an inconsistent stored count (for example a
  // row left at 0 by the old UTC-only implementation) without incrementing.
  if (snapshot.activeToday) {
    if (snapshot.streakCount !== user.streakCount) {
      await prisma.user
        .update({ where: { id: userId }, data: { streakCount: snapshot.streakCount } })
        .catch(() => null);
    }
    return { ...snapshot, changed: false };
  }

  const newStreak = snapshot.streakCount + 1;
  await prisma.user.update({
    where: { id: userId },
    data: { streakCount: newStreak, lastActiveDate: at },
  });

  const updated = deriveStreak(newStreak, at, at, timeZone);

  await logImportantInfo({
    event: 'streak_updated',
    userId,
    context: {
      prevStreak: user.streakCount,
      newStreak,
      wasAtRisk: snapshot.isAtRisk,
      timeZone: updated.timeZone,
    },
  });

  if ((STREAK_MILESTONES as readonly number[]).includes(newStreak)) {
    await createNotification(userId, {
      type: 'streak',
      title: `🔥 ${newStreak}-day streak unlocked`,
      message:
        `You've shown up ${newStreak} days in a row. That is not luck — it is a promise you keep ` +
        `to yourself. Next stop: ${updated.nextMilestone} days. Keep the fire alive.`,
      sendEmail: newStreak >= 7,
    }).catch(() => null);
  }

  return { ...updated, changed: true };
}

/**
 * The authoritative streak status for display.
 *
 * Normalises a stored count that no longer matches the calendar (for example
 * after a missed day) so the dashboard cannot advertise a streak that is
 * already over.
 */
export async function getStreakStatus(
  userId: string,
  at: Date = now(),
): Promise<StreakSnapshot> {
  const user = await loadStreakUser(userId);
  if (!user) return deriveStreak(0, null, at, 'UTC');

  const snapshot = deriveStreak(user.streakCount, user.lastActiveDate, at, user.profile?.timezone);

  if (snapshot.streakCount !== user.streakCount) {
    await prisma.user
      .update({ where: { id: userId }, data: { streakCount: snapshot.streakCount } })
      .catch(() => null);
  }

  return snapshot;
}

/**
 * Called by cron to warn users whose last activity was yesterday (the streak
 * ends if today passes without activity).
 *
 * Timezone-aware and deduped: running the cron twice in one day produces one
 * warning, not two.
 */
export async function sendStreakRiskNotifications(at: Date = now()): Promise<number> {
  // A yesterday-local timestamp is always within 48h of now, so this bound is
  // safe and keeps the candidate set small even as the user base grows.
  const candidates = await prisma.user.findMany({
    where: {
      streakCount: { gte: 2 },
      lastActiveDate: {
        not: null,
        gte: new Date(at.getTime() - 48 * 60 * 60 * 1000),
        lt: at,
      },
    },
    select: {
      id: true,
      streakCount: true,
      lastActiveDate: true,
      profile: { select: { timezone: true } },
    },
  });

  let notified = 0;

  for (const user of candidates) {
    const snapshot = deriveStreak(
      user.streakCount,
      user.lastActiveDate,
      at,
      user.profile?.timezone,
    );
    if (!snapshot.isAtRisk) continue;

    if (
      await notificationExistsOnLocalDay(
        user.id,
        'streak_risk',
        at,
        user.profile?.timezone,
      )
    ) {
      continue;
    }

    const dayWord = snapshot.streakCount === 1 ? 'day' : 'days';
    const milestoneWord = snapshot.daysToNextMilestone === 1 ? 'day' : 'days';

    await createNotification(user.id, {
      type: 'streak_risk',
      title: `🔥 Your ${snapshot.streakCount}-day streak is on the line`,
      message:
        `You've shown up ${snapshot.streakCount} ${dayWord} in a row. One small action today keeps ` +
        `the fire alive — even five minutes counts. You're only ${snapshot.daysToNextMilestone} ` +
        `${milestoneWord} from your ${snapshot.nextMilestone}-day milestone.`,
      sendEmail: snapshot.streakCount >= 5,
    });

    notified++;
  }

  if (notified > 0) {
    await logImportantInfo({
      event: 'streak_risk_notifications_sent',
      context: { notified },
    });
  }

  return notified;
}
