/**
 * Streak engine — reward daily engagement.
 *
 * Call `touchStreak(userId)` whenever a user performs a meaningful action
 * (add job, update job, apply, complete checklist task, etc.).
 *
 * Rules:
 *   - Same calendar day  → streak unchanged (idempotent)
 *   - Yesterday          → streakCount += 1
 *   - Older OR no date   → streakCount = 1 (start fresh)
 */

import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notifications';
import { logImportantInfo } from '@/lib/observability';

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function yesterday(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return toDateOnly(d);
}

export async function touchStreak(userId: string): Promise<{ streakCount: number; changed: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { streakCount: true, lastActiveDate: true },
  });
  if (!user) return { streakCount: 0, changed: false };

  const today = toDateOnly(new Date());
  const lastDay = user.lastActiveDate ? toDateOnly(user.lastActiveDate) : null;

  // Already tracked today — nothing to do
  if (lastDay === today) {
    return { streakCount: user.streakCount, changed: false };
  }

  // Calculate new streak
  const prevStreak = user.streakCount;
  const isConsecutive = lastDay === yesterday(new Date());
  const newStreak = isConsecutive ? prevStreak + 1 : 1;

  await prisma.user.update({
    where: { id: userId },
    data: { streakCount: newStreak, lastActiveDate: new Date() },
  });

  await logImportantInfo({
    event: 'streak_updated',
    userId,
    context: { prevStreak, newStreak, isConsecutive },
  });

  // Fire streak milestone notifications
  const milestones = [3, 5, 7, 14, 21, 30, 60, 90, 100];
  if (milestones.includes(newStreak)) {
    await createNotification(userId, {
      type: 'streak',
      title: `🔥 ${newStreak}-day streak!`,
      message: `You've been active ${newStreak} days in a row. Keep the momentum going!`,
      sendEmail: newStreak >= 7, // email on weekly+ milestones
    });
  }

  // Warn about streak risk the next day — handled by cron
  return { streakCount: newStreak, changed: true };
}

/** Called by cron to warn users whose last activity was 1 day ago (at risk tomorrow). */
export async function sendStreakRiskNotifications(): Promise<number> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfYesterday = new Date(yesterday);
  startOfYesterday.setHours(0, 0, 0, 0);
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);

  const atRisk = await prisma.user.findMany({
    where: {
      streakCount: { gte: 2 },
      lastActiveDate: { gte: startOfYesterday, lte: endOfYesterday },
    },
    select: { id: true, streakCount: true },
  });

  let notified = 0;
  for (const user of atRisk) {
    await createNotification(user.id, {
      type: 'streak',
      title: '⚠️ Don\'t lose your streak!',
      message: `You have a ${user.streakCount}-day streak. Log in and take an action today to keep it alive.`,
      sendEmail: user.streakCount >= 5,
    });
    notified++;
  }

  return notified;
}
