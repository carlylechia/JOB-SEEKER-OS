import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { hasEntitlement } from '@/lib/billing/subscriptions';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantError } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const userId = session.user.id;
  try {
    const allowed = await hasEntitlement(userId, 'DAILY_JOB_DISCOVERY');
    if (!allowed) return jsonError('Plan required', 403, undefined, request);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
    const run = await prisma.jobDiscoveryRun.findUnique({
      where: { userId_localDate: { userId, localDate: today } },
      include: {
        recommendations: {
          include: { externalJob: true },
          orderBy: { rank: 'asc' },
        },
      },
    });

    if (!run) {
      return jsonOk({ status: 'no_run', run: null, recommendations: [] }, request);
    }

    const recommendations = run.recommendations.map((r) => ({
      id: r.id,
      rank: r.rank,
      fitScore: r.fitScore,
      confidence: r.confidence,
      scoreBreakdown: r.scoreBreakdown,
      explanation: r.explanation,
      status: r.status,
      job: {
        id: r.externalJob.id,
        title: r.externalJob.title,
        company: r.externalJob.company,
        location: r.externalJob.location,
        remoteType: r.externalJob.remoteType,
        workArrangement: r.externalJob.workArrangement,
        employmentType: r.externalJob.employmentType,
        salaryMin: r.externalJob.salaryMin,
        salaryMax: r.externalJob.salaryMax,
        currency: r.externalJob.currency,
        publishedAt: r.externalJob.publishedAt,
        lastVerifiedAt: r.externalJob.lastVerifiedAt,
        applicationUrl: r.externalJob.applicationUrl,
        canonicalUrl: r.externalJob.canonicalUrl,
        source: r.externalJob.source,
        attribution: r.externalJob.attribution,
        status: r.externalJob.status,
      },
    }));

    return jsonOk({ status: run.status, run: { id: run.id, localDate: run.localDate, startedAt: run.startedAt, completedAt: run.completedAt, sourcesAttempted: run.sourcesAttempted, sourcesSucceeded: run.sourcesSucceeded }, recommendations }, request);
  } catch (error) {
    await logImportantError({ event: 'job_discovery_recommendations_failed', userId, error });
    return jsonError('Unable to load recommendations', 500, undefined, request);
  }
}
