import { prisma } from '@/lib/prisma';
import { normalizeCompany, normalizeTitle } from './normalize';
import { buildMatchExplanation, scoreExternalJob } from './scoring';
import { selectDiverseTop } from './ranking';
import { checkHardEligibility } from './eligibility';
import { computeConfidences, compositeRankingScore } from './confidence';
import { mapDbPreferences } from '@/lib/db-helpers';
import { logImportantInfo, logImportantError } from '@/lib/observability';

export function localDateKey(timezone: string, date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(date);
  }
}

export type RunDiscoveryOptions = {
  force?: boolean;
};

export async function runDiscoveryForUser(userId: string, options: RunDiscoveryOptions = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, profile: true },
  });
  if (!user) throw new Error('User not found');

  const profile = user.profile;
  const preferences = mapDbPreferences(profile);
  const timezone = preferences.timezone || 'UTC';
  const localDate = localDateKey(timezone);

  // Idempotency: reuse existing completed/partial snapshot unless force.
  let run = await prisma.jobDiscoveryRun.findUnique({
    where: { userId_localDate: { userId, localDate } },
  });

  if (run && ['COMPLETED', 'PARTIAL'].includes(run.status) && !options.force) {
    return run;
  }

  const excludedHistory = await prisma.dailyJobRecommendation.findMany({
    where: {
      userId,
      OR: [
        { status: 'SAVED' },
        { status: 'DISMISSED', createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } },
      ],
    },
    select: { externalJobId: true },
  });
  const excludedIds = new Set(excludedHistory.map((recommendation) => recommendation.externalJobId));

  if (!run) {
    run = await prisma.jobDiscoveryRun.create({
      data: { userId, localDate, timezone, status: 'RUNNING' },
    });
  } else {
    await prisma.jobDiscoveryRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', lastError: null, completedAt: null },
    });
    // clear previous recs
    await prisma.dailyJobRecommendation.deleteMany({ where: { runId: run.id } });
  }

  const runId = run.id;

  try {
    await logImportantInfo({ event: 'job_discovery_run_started', userId, context: { runId, localDate, timezone } });

    const latestCatalogRun = await prisma.jobCatalogSyncRun.findFirst({
      where: { status: { in: ['COMPLETED', 'PARTIAL'] } },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });

    // Read active catalogue listings from PostgreSQL
    const now = new Date();
    const freshnessCutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const sourceFreshnessCutoff = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);

    const pool = await prisma.externalJob.findMany({
      where: {
        status: 'OPEN',
        lastSeenAt: { gte: sourceFreshnessCutoff },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
        AND: [
          {
            OR: [
              { publishedAt: null },
              { publishedAt: { gte: freshnessCutoff } },
            ],
          },
          {
            OR: [
              { applicationUrl: { not: null } },
              { canonicalUrl: { not: null } },
            ],
          },
        ],
      },
      orderBy: [{ lastSeenAt: 'desc' }, { publishedAt: 'desc' }],
      take: 1000,
    });

    // Deduplicate any cross-source duplicates in memory by canonical key
    const seenDedupeKeys = new Set<string>();
    const uniquePool = pool.filter((job) => {
      const keys = [
        job.applicationUrl ? `url:${job.applicationUrl}` : null,
        job.canonicalUrl ? `canon:${job.canonicalUrl}` : null,
        `ct:${normalizeCompany(job.company)}|${normalizeTitle(job.title)}|${(job.location ?? '').toLowerCase().trim()}`,
      ].filter(Boolean) as string[];

      if (keys.some((k) => seenDedupeKeys.has(k))) {
        return false;
      }
      for (const k of keys) seenDedupeKeys.add(k);
      return true;
    });

    const eligibleCandidates: Array<{
      job: (typeof pool)[number];
      fitScore: number;
      fitTier: string;
      scoreFields: ReturnType<typeof scoreExternalJob>['scoreFields'];
      eligibility: ReturnType<typeof checkHardEligibility>;
      confidences: ReturnType<typeof computeConfidences>;
      rankingScore: number;
      company: string;
      title: string;
      source: string;
      publishedAt: Date | null;
    }> = [];

    for (const job of uniquePool) {
      if (excludedIds.has(job.id)) continue;

      const eligibility = checkHardEligibility(
        {
          status: job.status,
          title: job.title,
          applicationUrl: job.applicationUrl,
          canonicalUrl: job.canonicalUrl,
          expiresAt: job.expiresAt,
          publishedAt: job.publishedAt,
          lastSeenAt: job.lastSeenAt,
          workArrangement: job.workArrangement,
          remoteType: job.remoteType,
          location: job.location,
          countryCodes: job.countryCodes,
          locationRestrictions: job.locationRestrictions,
          employmentType: job.employmentType,
          visaSponsorship: job.visaSponsorship,
        },
        {
          remoteOnly: preferences.remoteOnly,
          workCountries: preferences.workCountries,
          employmentTypes: preferences.employmentTypes,
          visaSponsorshipRequired: preferences.visaSponsorshipRequired,
          now,
        },
      );

      if (!eligibility.eligible) continue;

      const { scoreFields, fitScore, fitTier } = scoreExternalJob(
        {
          title: job.title,
          location: job.location,
          remoteType: job.remoteType,
          workArrangement: job.workArrangement,
          countryCodes: job.countryCodes,
          locationRestrictions: job.locationRestrictions,
          timezoneRestrictions: job.timezoneRestrictions,
          employmentType: job.employmentType,
          seniority: job.seniority,
          industry: job.industry,
          category: job.category,
          visaSponsorship: job.visaSponsorship,
          eligibilityRegion: null,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          currency: job.currency,
          salaryPeriod: job.salaryPeriod,
          description: job.description,
          publishedAt: job.publishedAt,
          applicationUrl: job.applicationUrl,
          canonicalUrl: job.canonicalUrl,
        },
        preferences,
      );

      if (fitScore < 30) continue;
      if (scoreFields.postedWithinThirtyDays === false) continue;

      const confidences = computeConfidences({
        company: job.company,
        title: job.title,
        description: job.description,
        location: job.location,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        applicationUrl: job.applicationUrl,
        attribution: job.attribution,
        employmentType: job.employmentType,
        seniority: job.seniority,
        publishedAt: job.publishedAt,
        countryCodes: job.countryCodes,
        industry: job.industry,
        category: job.category,
        source: job.source,
        lastSeenAt: job.lastSeenAt,
      });

      const rankingScore = compositeRankingScore(fitScore, confidences);

      eligibleCandidates.push({
        job,
        fitScore,
        fitTier,
        scoreFields,
        eligibility,
        confidences,
        rankingScore,
        company: job.company,
        title: job.title,
        source: job.source,
        publishedAt: job.publishedAt,
      });
    }

    const top = selectDiverseTop(eligibleCandidates, 5);

    // Create daily recommendations
    for (let i = 0; i < top.length; i++) {
      const c = top[i];
      await prisma.dailyJobRecommendation.create({
        data: {
          runId,
          userId,
          externalJobId: c.job.id,
          rank: i + 1,
          fitScore: c.fitScore,
          confidence: c.confidences.dataConfidence,
          listingQuality: c.confidences.listingQuality,
          sourceConfidence: c.confidences.sourceConfidence,
          dataConfidence: c.confidences.dataConfidence,
          rankingScore: c.rankingScore,
          scoreBreakdown: c.scoreFields,
          eligibility: c.eligibility.checks as any,
          explanation: buildMatchExplanation(c.job, preferences, c.scoreFields, c.fitScore),
          status: 'RECOMMENDED',
        },
      });
    }

    const distinctSources = new Set(uniquePool.map((j) => j.source)).size;
    await prisma.jobDiscoveryRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        candidateCount: uniquePool.length,
        eligibleCount: eligibleCandidates.length,
        recommendationCount: top.length,
        catalogSyncRunId: latestCatalogRun?.id ?? null,
        sourcesAttempted: distinctSources,
        sourcesSucceeded: distinctSources,
        lastError: null,
      },
    });

    await logImportantInfo({
      event: 'job_discovery_run_completed',
      userId,
      context: {
        runId,
        localDate,
        candidates: uniquePool.length,
        eligible: eligibleCandidates.length,
        recommendations: top.length,
      },
    });

    return prisma.jobDiscoveryRun.findUnique({ where: { id: runId } });
  } catch (err) {
    await prisma.jobDiscoveryRun.update({
      where: { id: runId },
      data: { status: 'FAILED', completedAt: new Date(), lastError: err instanceof Error ? err.message : 'unknown' },
    });
    await logImportantError({ event: 'job_discovery_run_failed', userId, error: err, context: { runId } });
    throw err;
  }
}
