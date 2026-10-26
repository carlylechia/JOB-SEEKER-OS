import { prisma } from '@/lib/prisma';
import { getConnectors } from './registry';
import { normalizeJob } from './normalize';
import { dedupeExternalJobs } from './dedupe';
import { buildSearchPlan } from './search-plan';
import { scoreExternalJob } from './scoring';
import { getUserPreferences } from '@/lib/db-helpers';
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

    const plan = buildSearchPlan(profile, preferences);

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
    const externalIds: string[] = [];
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
      externalIds.push(record.id);
    }

    // Score and select
    const candidates: Array<{ externalId: string; job: any; fitScore: number; fitTier: string; scoreFields: any }> = [];
    for (let i = 0; i < deduped.length; i++) {
      const job = deduped[i];
      const recordId = externalIds[i];
      // hard exclusions
      if (!job.applicationUrl && !job.canonicalUrl) continue;
      const { scoreFields, fitScore, fitTier } = scoreExternalJob(
        {
          title: job.title,
          location: job.location ?? null,
          remoteType: job.remoteType ?? null,
          eligibilityRegion: null,
          salaryMin: job.salaryMin ?? null,
          salaryMax: job.salaryMax ?? null,
          currency: job.currency ?? null,
        },
        preferences,
      );
      if (fitScore < 30) continue;
      const external = await prisma.externalJob.findUnique({ where: { id: recordId } });
      candidates.push({ externalId: recordId, job: external, fitScore, fitTier, scoreFields });
    }

    candidates.sort((a, b) => b.fitScore - a.fitScore || (b.job?.publishedAt?.getTime() ?? 0) - (a.job?.publishedAt?.getTime() ?? 0));

    const top = candidates.slice(0, 5);

    // Create recommendations
    for (let i = 0; i < top.length; i++) {
      const c = top[i];
      const confidence = c.job?.description ? 0.7 : 0.4;
      await prisma.dailyJobRecommendation.create({
        data: {
          runId,
          userId,
          externalJobId: c.externalId,
          rank: i + 1,
          fitScore: c.fitScore,
          confidence,
          scoreBreakdown: c.scoreFields,
          explanation: {
            reasons: [
              c.fitScore >= 80 ? 'Strong overall fit' : 'Potential fit',
            ],
            gaps: [],
          },
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
        candidateCount: deduped.length,
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
      context: { runId, status, candidates: deduped.length, recommendations: top.length, discarded },
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
