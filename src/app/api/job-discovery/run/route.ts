import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { hasEntitlement } from '@/lib/billing/subscriptions';
import { runDiscoveryForUser } from '@/lib/job-discovery/service';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantError, logImportantInfo } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);
  const userId = session.user.id;
  try {
    await hasEntitlement(userId, 'DAILY_JOB_DISCOVERY');
  } catch (e) {
    return jsonError('Plan required', 403, undefined, request);
  }

  // simple cooldown: if run completed within last 6 hours, block
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
  const existing = await (await import('@/lib/prisma')).prisma.jobDiscoveryRun.findUnique({ where: { userId_localDate: { userId, localDate: today } } });
  if (existing?.completedAt) {
    const ageMs = Date.now() - new Date(existing.completedAt).getTime();
    if (ageMs < 6 * 60 * 60 * 1000) {
      return jsonError('Refresh cooldown active', 429, undefined, request);
    }
  }

  try {
    const run = await runDiscoveryForUser(userId, { force: true });
    await logImportantInfo({ event: 'job_discovery_manual_refresh', userId, context: { runId: run?.id } });
    return jsonOk({ ok: true, runId: run?.id }, request);
  } catch (error) {
    await logImportantError({ event: 'job_discovery_manual_refresh_failed', userId, error });
    return jsonError('Unable to refresh discovery', 500, undefined, request);
  }
}
