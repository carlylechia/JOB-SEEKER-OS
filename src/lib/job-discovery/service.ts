import { prisma } from '@/lib/prisma';
import { getConnectors } from './registry';
import { normalizeJob } from './normalize';
import { dedupeExternalJobs } from './dedupe';
import { buildSearchPlan } from './search-plan';
import { buildMatchExplanation, scoreExternalJob } from './scoring';
import { selectDiverseTop } from './ranking';
import { mapDbPreferences } from '@/lib/db-helpers';
import { logImportantInfo, logImportantError } from '@/lib/observability';
import { updateSourceHealth } from './source-health';
import type { NormalizedExternalJob } from './types';

function localDateKey(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
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
  const timezone = 'UTC'; // documented fallback; profile has no tz field
  const localDate = localDateKey(timezone);

  // Idempotency: reuse existing run unless force.
  let run = await prisma.jobDiscoveryRun.findUnique({
    where: { userId_localDate: { userId, localDate } },
  });

  if (run && !options.force) {
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
    await logImportantInfo({ event: 'job_discovery_run_started', userId, context: { runId, localDate } });

    const plan = buildSearchPlan(
      profile && typeof profile === 'object'
        ? {
            location: 'location' in profile && typeof profile.location === 'string' ? profile.location : null,
            headline: 'headline' in profile && typeof profile.headline === 'string' ? profile.headline : null,
          }
        : null,
      preferences,
    );

    if (plan.titles.length === 0) {
      await prisma.jobDiscoveryRun.update({
        where: { id: runId },
        data: { status: 'COMPLETED', completedAt: new Date(), candidateCount: 0, eligibleCount: 0, recommendationCount: 0 },
      });
      return prisma.jobDiscoveryRun.findUnique({ where: { id: runId } }) as any;
    }

    const connectors = getConnectors();
    const enabled = connectors.filter((c) => c.isEnabled());

    let allJobs: NormalizedExternalJob[] = [];
    let sourcesAttempted = 0;
    let sourcesSucceeded = 0;
    const errors: string[] = [];

    for (const connector of enabled) {
      sourcesAttempted += 1;
      try {
        const result = await connector.search({
          titles: plan.titles,
          locations: plan.locations,
          remoteOnly: plan.remoteOnly,
          limit: plan.limit,
        });
        if (result.errors?.includes('NOT_CONFIGURED')) {
          await updateSourceHealth(connector, false, 'NOT_CONFIGURED');
          continue;
        }
        const normalized = result.jobs.map(normalizeJob);
        allJobs = allJobs.concat(normalized);
        sourcesSucceeded += 1;
        await updateSourceHealth(connector, true, undefined, result.jobs.length);
      } catch (err) {
        errors.push(`${connector.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        await updateSourceHealth(connector, false, 'PROVIDER_ERROR', 0, err instanceof Error ? err.message : 'unknown');
      }
    }

    // Also record health for disabled/unconfigured connectors
    for (const connector of connectors.filter((c) => !c.isEnabled())) {
      await updateSourceHealth(connector, false, connector.isConfigured() ? 'DISABLED' : 'NOT_CONFIGURED');
    }

    const { jobs: deduped, discarded } = dedupeExternalJobs(allJobs);

    // Persist external jobs
    const persistedJobs: Array<Awaited<ReturnType<typeof prisma.externalJob.findUnique>>> = [];
    for (const job of deduped) {
      const existing = await prisma.externalJob.findUnique({
        where: { source_sourceJobId: { source: job.source, sourceJobId: job.sourceJobId } },
      });
      let record;
      if (existing) {
        record = await prisma.externalJob.update({
          where: { id: existing.id },
          data: {
            title: job.title,
            company: job.company,
            location: job.location,
            remoteType: job.remoteType,
            workArrangement: job.workArrangement,
            employmentType: job.employmentType,
            description: job.description,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            currency: job.currency,
            publishedAt: job.publishedAt,
            canonicalUrl: job.canonicalUrl,
            applicationUrl: job.applicationUrl,
            employerUrl: job.employerUrl,
            lastSeenAt: new Date(),
            contentFingerprint: job.contentFingerprint,
            attribution: job.attribution,
            status: 'OPEN',
          },
        });
      } else {
        record = await prisma.externalJob.create({
          data: {
            source: job.source,
            sourceJobId: job.sourceJobId,
            title: job.title,
            company: job.company,
            location: job.location,
            remoteType: job.remoteType,
            workArrangement: job.workArrangement,
            employmentType: job.employmentType,
            description: job.description,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            currency: job.currency,
            publishedAt: job.publishedAt,
            canonicalUrl: job.canonicalUrl,
            applicationUrl: job.applicationUrl,
            employerUrl: job.employerUrl,
            contentFingerprint: job.contentFingerprint,
            attribution: job.attribution,
            status: 'OPEN',
          },
        });
      }
      persistedJobs.push(record);
    }

    // Reuse recently verified listings from the shared free-source index so
    // discovery does not depend on one user's exact query being in the feed.
    const cacheSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const publishedSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const cachedJobs = await prisma.externalJob.findMany({
      where: {
        status: 'OPEN',
        lastSeenAt: { gte: cacheSince },
        OR: [{ publishedAt: null }, { publishedAt: { gte: publishedSince } }],
        AND: [{ OR: [{ applicationUrl: { not: null } }, { canonicalUrl: { not: null } }] }],
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 500,
    });
    const pooledJobs = new Map(
      [...persistedJobs, ...cachedJobs].filter((job): job is NonNullable<typeof job> => job !== null)
        .map((job) => [job.id, job]),
    );
    const externalByKey = new Map<string, (typeof cachedJobs)[number]>();
    const uniquePool = dedupeExternalJobs(
      [...pooledJobs.values()].map((job) => {
        externalByKey.set(`${job.source}:${job.sourceJobId}`, job);
        return {
          source: job.source,
          sourceJobId: job.sourceJobId,
          title: job.title,
          company: job.company,
          location: job.location,
          applicationUrl: job.applicationUrl,
          canonicalUrl: job.canonicalUrl,
          contentFingerprint: job.contentFingerprint,
        };
      }),
    );
    const uniqueJobs = uniquePool.jobs
      .map((job) => externalByKey.get(`${job.source}:${job.sourceJobId}`))
      .filter((job): job is (typeof cachedJobs)[number] => job !== undefined);

    // Score once per listing using its actual posting text and the user's saved
    // role, skill, location, seniority and compensation preferences.
    const candidates: Array<{
      externalId: string;
      job: (typeof cachedJobs)[number];
      fitScore: number;
      fitTier: string;
      scoreFields: ReturnType<typeof scoreExternalJob>['scoreFields'];
    }> = [];
    for (const external of uniqueJobs) {
      if (excludedIds.has(external.id)) continue;
      const { scoreFields, fitScore, fitTier } = scoreExternalJob(
        {
          title: external.title,
          location: external.location,
          remoteType: external.remoteType,
          workArrangement: external.workArrangement,
          eligibilityRegion: null,
          salaryMin: external.salaryMin,
          salaryMax: external.salaryMax,
          currency: external.currency,
          description: external.description,
          publishedAt: external.publishedAt,
          applicationUrl: external.applicationUrl,
          canonicalUrl: external.canonicalUrl,
        },
        preferences,
      );
      if (fitScore < 30) continue;
      if (scoreFields.postedWithinThirtyDays === false) continue;
      candidates.push({ externalId: external.id, job: external, fitScore, fitTier, scoreFields });
    }

    const top = selectDiverseTop(
      candidates.map((candidate) => ({
        ...candidate,
        company: candidate.job.company,
        title: candidate.job.title,
        publishedAt: candidate.job.publishedAt,
      })),
      5,
    );

    // Create recommendations
    for (let i = 0; i < top.length; i++) {
      const c = top[i];
      const confidence = c.scoreFields.score.signalQuality / 5;
      await prisma.dailyJobRecommendation.create({
        data: {
          runId,
          userId,
          externalJobId: c.externalId,
          rank: i + 1,
          fitScore: c.fitScore,
          confidence,
          scoreBreakdown: c.scoreFields,
          explanation: buildMatchExplanation(c.job, preferences, c.scoreFields, c.fitScore),
          status: 'RECOMMENDED',
        },
      });
    }

    const status = sourcesSucceeded === sourcesAttempted ? 'COMPLETED' : sourcesSucceeded > 0 ? 'PARTIAL' : 'FAILED';
    await prisma.jobDiscoveryRun.update({
      where: { id: runId },
      data: {
        status,
        completedAt: new Date(),
        candidateCount: uniqueJobs.length,
        eligibleCount: candidates.length,
        recommendationCount: top.length,
        sourcesAttempted,
        sourcesSucceeded,
        lastError: errors.length ? errors.join('; ') : null,
      },
    });

    await logImportantInfo({
      event: 'job_discovery_run_completed',
      userId,
      context: {
        runId,
        status,
        candidates: uniqueJobs.length,
        recommendations: top.length,
        discarded: discarded + uniquePool.discarded,
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
