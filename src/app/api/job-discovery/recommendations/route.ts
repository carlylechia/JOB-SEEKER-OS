import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { hasEntitlement } from '@/lib/billing/subscriptions';
import { localDateKey } from '@/lib/job-discovery/service';
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

    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    const today = localDateKey(profile?.timezone || 'UTC');

    const run = await prisma.jobDiscoveryRun.findUnique({
      where: { userId_localDate: { userId, localDate: today } },
      include: {
        recommendations: {
          include: { externalJob: true },
          orderBy: { rank: 'asc' },
          where: { status: { notIn: ['DISMISSED', 'SUPERSEDED'] } },
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
      listingQuality: r.listingQuality,
      sourceConfidence: r.sourceConfidence,
      dataConfidence: r.dataConfidence,
      rankingScore: r.rankingScore,
      scoreBreakdown: r.scoreBreakdown,
      eligibility: r.eligibility,
      explanation: r.explanation,
      status: r.status,
      job: {
        id: r.externalJob.id,
        title: r.externalJob.title,
        company: r.externalJob.company,
        location: r.externalJob.location,
        countryCodes: r.externalJob.countryCodes,
        locationRestrictions: r.externalJob.locationRestrictions,
        timezoneRestrictions: r.externalJob.timezoneRestrictions,
        remoteType: r.externalJob.remoteType,
        workArrangement: r.externalJob.workArrangement,
        employmentType: r.externalJob.employmentType,
        seniority: r.externalJob.seniority,
        industry: r.externalJob.industry,
        category: r.externalJob.category,
        visaSponsorship: r.externalJob.visaSponsorship,
        salaryMin: r.externalJob.salaryMin,
        salaryMax: r.externalJob.salaryMax,
        currency: r.externalJob.currency,
        salaryPeriod: r.externalJob.salaryPeriod,
        publishedAt: r.externalJob.publishedAt,
        lastVerifiedAt: r.externalJob.lastVerifiedAt,
        applicationUrl: r.externalJob.applicationUrl,
        canonicalUrl: r.externalJob.canonicalUrl,
        source: r.externalJob.source,
        attribution: r.externalJob.attribution,
        attributionUrl: r.externalJob.attributionUrl,
        attributionRequired: r.externalJob.attributionRequired,
        allowStructuredData: r.externalJob.allowStructuredData,
        status: r.externalJob.status,
      },
    }));

    return jsonOk(
      {
        status: run.status,
        run: {
          id: run.id,
          localDate: run.localDate,
          timezone: run.timezone,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          candidateCount: run.candidateCount,
          eligibleCount: run.eligibleCount,
          recommendationCount: run.recommendationCount,
          sourcesAttempted: run.sourcesAttempted,
          sourcesSucceeded: run.sourcesSucceeded,
        },
        recommendations,
      },
      request,
    );
  } catch (error) {
    await logImportantError({ event: 'job_discovery_recommendations_failed', userId, error });
    return jsonError('Unable to load recommendations', 500, undefined, request);
  }
}
