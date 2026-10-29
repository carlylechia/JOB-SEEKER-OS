/**
 * /api/cron/queue
 *
 * Cron-safe endpoint that:
 *  1. Sends one daily queue digest per user, listing their top moves and
 *     tying the reminder to their streak.
 *  2. Warns users whose streak is at risk today.
 *
 * Protect with CRON_SECRET header in production:
 *  Authorization: Bearer <CRON_SECRET>
 *
 * Authorization uses `isCronAuthorized`, which FAILS CLOSED: with no
 * CRON_SECRET configured this endpoint is unreachable rather than public.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendDailyDigest } from '@/lib/daily-digest';
import { sendStreakRiskNotifications } from '@/lib/streak';
import { logImportantInfo, logImportantError } from '@/lib/observability';
import { isCronAuthorized } from '@/lib/cron-auth';
import { now } from '@/lib/billing/clock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Fail closed — previously this only guarded when CRON_SECRET was set, which
  // left the endpoint publicly reachable whenever the variable was missing.
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const at = now();
  const summary = {
    users: 0,
    digests: 0,
    skipped: 0,
    streakWarnings: 0,
    errors: 0,
  };

  try {
    const users = await prisma.user.findMany({
      select: { id: true },
      where: { emailVerified: { not: null } },
    });

    summary.users = users.length;

    for (const user of users) {
      try {
        const sent = await sendDailyDigest(user.id, { at });
        if (sent) summary.digests++;
        else summary.skipped++;
      } catch (err) {
        summary.errors++;
        await logImportantError({
          event: 'cron_queue_user_failed',
          userId: user.id,
          error: err,
        });
      }
    }

    summary.streakWarnings = await sendStreakRiskNotifications(at);

    await logImportantInfo({
      event: 'daily_queue_notifications_generated',
      context: summary,
    });

    return NextResponse.json(
      { ok: true, summary },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    await logImportantError({ event: 'cron_queue_failed', error: err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
