/**
 * /api/cron/queue
 *
 * Cron-safe endpoint that:
 *  1. Generates daily queue notifications for all users
 *  2. Warns users whose streak is at risk
 *
 * Protect with CRON_SECRET header in production:
 *  Authorization: Bearer <CRON_SECRET>
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notifications';
import { sendStreakRiskNotifications } from '@/lib/streak';
import { logImportantInfo, logImportantError } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Guard with CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const summary = { users: 0, notifications: 0, streakWarnings: 0, errors: 0 };

  try {
    // Process each user
    const users = await prisma.user.findMany({
      select: { id: true, emailVerified: true },
      where: { emailVerified: { not: null } },
    });

    summary.users = users.length;

    for (const user of users) {
      try {
        await processUserQueue(user.id);
        summary.notifications++;
      } catch (err) {
        summary.errors++;
        await logImportantError({
          event: 'cron_queue_user_failed',
          userId: user.id,
          error: err,
        });
      }
    }

    // Streak risk notifications
    const warned = await sendStreakRiskNotifications();
    summary.streakWarnings = warned;

    await logImportantInfo({
      event: 'queue_generated',
      context: summary,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    await logImportantError({ event: 'cron_queue_failed', error: err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

async function processUserQueue(userId: string): Promise<void> {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const jobs = await prisma.jobLead.findMany({
    where: { userId, deletedAt: null },
    select: {
      id: true,
      status: true,
      priorityFlag: true,
      nextFollowUp: true,
      dateApplied: true,
      company: true,
      title: true,
    },
  });

  const followUpsDue = jobs.filter(
    (j) => j.nextFollowUp && new Date(j.nextFollowUp) >= today && new Date(j.nextFollowUp) < tomorrow,
  );

  const staleApplied = jobs.filter((j) => {
    if (j.status !== 'APPLIED' || !j.dateApplied) return false;
    const daysSince = Math.floor((now.getTime() - new Date(j.dateApplied).getTime()) / 86_400_000);
    return daysSince >= 7 && daysSince < 8; // exactly 7 days
  });

  const topNotApplied = jobs.filter(
    (j) => j.priorityFlag === 'TOP_PICK' && j.status === 'LEAD',
  );

  const messages: Array<{ type: 'follow_up_due' | 'queue_reminder' | 'queue_reminder'; title: string; msg: string }> = [];

  if (followUpsDue.length > 0) {
    messages.push({
      type: 'follow_up_due',
      title: `📬 ${followUpsDue.length} follow-up${followUpsDue.length > 1 ? 's' : ''} due today`,
      msg: followUpsDue.slice(0, 3).map((j) => `${j.company} — ${j.title}`).join(', ') +
        (followUpsDue.length > 3 ? ` +${followUpsDue.length - 3} more` : ''),
    });
  }

  if (staleApplied.length > 0) {
    messages.push({
      type: 'queue_reminder',
      title: `⏰ ${staleApplied.length} application${staleApplied.length > 1 ? 's' : ''} need a follow-up`,
      msg: `It's been 7+ days since you applied to ${staleApplied[0].company}${staleApplied.length > 1 ? ` and ${staleApplied.length - 1} others` : ''}. Time to follow up!`,
    });
  }

  if (topNotApplied.length > 0) {
    messages.push({
      type: 'queue_reminder',
      title: `🎯 ${topNotApplied.length} top job${topNotApplied.length > 1 ? 's' : ''} still untouched`,
      msg: `You haven't applied to ${topNotApplied[0].company} — ${topNotApplied[0].title}${topNotApplied.length > 1 ? ` and ${topNotApplied.length - 1} others` : ''} yet.`,
    });
  }

  for (const m of messages) {
    await createNotification(userId, {
      type: m.type as 'follow_up_due' | 'queue_reminder',
      title: m.title,
      message: m.msg,
      sendEmail: true,
    });
  }
}
