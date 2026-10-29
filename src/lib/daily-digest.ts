/**
 * Daily queue digest.
 *
 * The daily queue is only useful if the user sees it. This module turns the
 * top career actions into one motivating notification per local day, with
 * streak context so the reminder and the streak reinforce each other instead
 * of competing for attention.
 *
 * It is deterministic (no model call) and idempotent: the cron can be retried
 * or run manually without sending the same digest twice.
 */

import { prisma } from '@/lib/prisma';
import { now } from '@/lib/billing/clock';
import { createNotification, notificationExistsOnLocalDay } from '@/lib/notifications';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { syncCareerActions, listCareerActions } from '@/lib/career-queue/service';
import { deriveStreak, type StreakSnapshot } from './streak-core';

/**
 * Deliberately varied, human motivation. Picked deterministically per user and
 * day so the reminder feels fresh without pretending to be a personality.
 */
const MOTIVATION_LINES = [
  'Momentum is built one honest move at a time.',
  'You do not need a perfect day — just a forward one.',
  'The best time to protect your streak is before it slips.',
  'Small steps, repeated, become unstoppable.',
  'Future you is watching. Give them something to thank you for.',
  'One action today beats ten intentions tomorrow.',
  'Consistency is a quiet kind of confidence.',
  'The job you want is on the other side of the task you keep postponing.',
  'Show up for five minutes. Momentum will do the rest.',
  'Your future is built in ordinary hours, not perfect ones.',
  'Every application is a vote for the life you are building.',
  'Keep the promise you made to yourself.',
] as const;

export type DigestTask = {
  title: string;
  priority: number;
  estimatedMinutes?: number | null;
};

export type DailyDigestContent = {
  title: string;
  message: string;
  topPriority: number;
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function pickMotivation(userId: string, dayKey: string): string {
  return MOTIVATION_LINES[hashString(`${userId}:${dayKey}`) % MOTIVATION_LINES.length];
}

/**
 * Builds the notification copy. Pure so the wording can be tested without a
 * database or an email provider.
 */
export function buildDailyDigest(input: {
  userId: string;
  firstName?: string | null;
  dayKey: string;
  streak: StreakSnapshot;
  tasks: DigestTask[];
}): DailyDigestContent {
  const { userId, firstName, dayKey, streak, tasks } = input;
  const shown = tasks.slice(0, 3);
  const count = tasks.length;
  const moveWord = count === 1 ? 'move' : 'moves';

  const title =
    streak.streakCount >= 2
      ? `🔥 Day ${streak.streakCount} — ${count} ${moveWord} to keep the fire alive`
      : `🎯 ${count} ${moveWord} to make today count`;

  const lines: string[] = [];
  const shownLabel =
    shown.length === 1 ? 'your top move today' : `your top ${shown.length} moves today`;
  lines.push(firstName ? `${firstName}, ${shownLabel}:` : `${shownLabel.charAt(0).toUpperCase()}${shownLabel.slice(1)}:`);

  shown.forEach((task, index) => {
    const minutes = task.estimatedMinutes ? ` · ${task.estimatedMinutes} min` : '';
    lines.push(`${index + 1}. ${task.title}${minutes}`);
  });

  if (count > shown.length) {
    lines.push(`+${count - shown.length} more waiting in your queue.`);
  }

  lines.push('');

  if (streak.isAtRisk) {
    lines.push(
      `🔥 Your ${streak.streakCount}-day streak is on the line. One move today keeps it alive.`,
    );
  } else if (streak.streakCount >= 2) {
    lines.push(
      `🔥 Day ${streak.streakCount}. You've already shown up — protect the fire with one honest move.`,
    );
  } else if (streak.streakCount === 1) {
    lines.push('🌱 Day 1. The first step is the one that changes everything.');
  } else {
    lines.push('🌱 Every streak starts with a single move. Make today the day.');
  }

  const milestoneWord = streak.daysToNextMilestone === 1 ? 'day' : 'days';
  lines.push(
    `⏳ ${streak.daysToNextMilestone} ${milestoneWord} to your ${streak.nextMilestone}-day milestone.`,
  );

  lines.push('');
  lines.push(`“${pickMotivation(userId, dayKey)}”`);
  lines.push('Open your queue → /queue');

  return {
    title,
    message: lines.join('\n'),
    topPriority: tasks[0]?.priority ?? 0,
  };
}

/**
 * Sends at most one daily digest per user per ~day.
 *
 * Returns true when a notification was created, false when it was skipped
 * (already sent, no actions, or no user).
 */
export async function sendDailyDigest(
  userId: string,
  options: { at?: Date } = {},
): Promise<boolean> {
  const at = options.at ?? now();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      streakCount: true,
      lastActiveDate: true,
      profile: { select: { timezone: true } },
    },
  });
  if (!user) return false;

  const timeZone = user.profile?.timezone;
  if (await notificationExistsOnLocalDay(userId, 'daily_digest', at, timeZone)) {
    return false;
  }

  // Refresh system actions so the digest reflects today's data rather than
  // whatever happened to be in the table. A failure here must not suppress an
  // existing queue.
  try {
    await syncCareerActions(userId);
  } catch (error) {
    await logImportantError({
      event: 'daily_digest_sync_failed',
      userId,
      error,
    });
  }

  const actions = await listCareerActions(userId, { limit: 5 });
  if (actions.length === 0) return false;

  const streak = deriveStreak(
    user.streakCount,
    user.lastActiveDate,
    at,
    user.profile?.timezone,
  );

  const content = buildDailyDigest({
    userId,
    firstName: user.name?.split(' ')[0] ?? null,
    dayKey: streak.todayKey,
    streak,
    tasks: actions.map((action) => ({
      title: action.title,
      priority: action.priority,
      estimatedMinutes: action.estimatedMinutes,
    })),
  });

  await createNotification(userId, {
    type: 'daily_digest',
    title: content.title,
    message: content.message,
    // High-priority work is worth an email; ordinary queue upkeep stays in-app.
    sendEmail: content.topPriority >= 90,
  });

  await logImportantInfo({
    event: 'daily_digest_sent',
    userId,
    context: {
      actions: actions.length,
      topPriority: content.topPriority,
      streakCount: streak.streakCount,
      timeZone: streak.timeZone,
    },
  });

  return true;
}
