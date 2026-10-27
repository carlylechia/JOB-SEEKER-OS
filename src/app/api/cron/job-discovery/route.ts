import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isCronAuthorized } from '@/lib/cron-auth';
import { hasEntitlement } from '@/lib/billing/subscriptions';
import { runDiscoveryForUser } from '@/lib/job-discovery/service';
import { logImportantInfo, logImportantError } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 20;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
  const now = new Date();
  const summary = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

  try {
    const users = await prisma.user.findMany({
      select: { id: true },
      where: {
        emailVerified: { not: null },
        jobDiscoveryRuns: {
          none: { localDate: today, status: { in: ['COMPLETED', 'PARTIAL'] } },
        },
        OR: [
          { role: 'ADMIN' },
          {
            subscription: {
              is: {
                plan: { is: { code: { in: ['PRO', 'PREMIUM'] } } },
                OR: [
                  {
                    status: 'TRIALING',
                    trialStartsAt: { lte: now },
                    trialEndsAt: { gt: now },
                  },
                  {
                    status: 'ACTIVE',
                    startsAt: { lte: now },
                    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
                  },
                ],
              },
            },
          },
        ],
      },
      orderBy: [
        { jobDiscoveryRuns: { _count: 'asc' } },
        { id: 'asc' },
      ],
      take: BATCH_SIZE,
    });

    for (const user of users) {
      try {
        const allowed = await hasEntitlement(user.id, 'DAILY_JOB_DISCOVERY');
        if (!allowed) {
          summary.skipped += 1;
          continue;
        }
        const existing = await prisma.jobDiscoveryRun.findUnique({
          where: { userId_localDate: { userId: user.id, localDate: today } },
        });
        if (existing && ['COMPLETED', 'PARTIAL', 'RUNNING'].includes(existing.status)) {
          summary.skipped += 1;
          continue;
        }
        await runDiscoveryForUser(user.id, { force: Boolean(existing) });
        summary.processed += 1;
        summary.succeeded += 1;
      } catch (err) {
        summary.failed += 1;
        await logImportantError({ event: 'job_discovery_cron_user_failed', userId: user.id, error: err });
      }
    }

    await logImportantInfo({ event: 'job_discovery_cron_completed', context: summary });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    await logImportantError({ event: 'job_discovery_cron_failed', error: err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
