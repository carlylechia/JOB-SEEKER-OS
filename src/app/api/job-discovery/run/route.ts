import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { hasEntitlement } from '@/lib/billing/subscriptions';
import { runDiscoveryForUser, localDateKey } from '@/lib/job-discovery/service';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantError, logImportantInfo } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);
  const userId = session.user.id;
  try {
    const allowed = await hasEntitlement(userId, 'DAILY_JOB_DISCOVERY');
    if (!allowed) return jsonError('Plan required', 403, undefined, request);
  } catch {
    return jsonError('Plan required', 403, undefined, request);
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const today = localDateKey(profile?.timezone || 'UTC');

  const existing = await prisma.jobDiscoveryRun.findUnique({
    where: { userId_localDate: { userId, localDate: today } },
  });

  // If a run is currently in-flight, avoid duplicate simultaneous runs
  if (existing?.status === 'RUNNING') {
    return jsonOk({ ok: true, runId: existing.id, inProgress: true }, request);
  }

  try {
    // Manual refresh creates a fresh shortlist from the current catalogue.
    // The discovery service carries forward dismissed/saved exclusions and
    // skips the previous shortlist so refresh does not simply repeat it.
    const run = await runDiscoveryForUser(userId, { force: true });
    await logImportantInfo({ event: 'job_discovery_manual_refresh', userId, context: { runId: run?.id } });
    return jsonOk({ ok: true, runId: run?.id }, request);
  } catch (error) {
    await logImportantError({ event: 'job_discovery_manual_refresh_failed', userId, error });
    return jsonError('Unable to refresh discovery', 500, undefined, request);
  }
}
