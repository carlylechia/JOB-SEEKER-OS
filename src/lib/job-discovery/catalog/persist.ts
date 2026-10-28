import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { computeConfidences } from '../confidence';
import { dedupeExternalJobs } from '../dedupe';
import type { NormalizedExternalJob } from '../types';

export type PersistResult = {
  created: number;
  updated: number;
  touched: number;
  duplicatesDiscarded: number;
  accepted: number;
};

function jobData(job: NormalizedExternalJob, now: Date, existing: boolean): Prisma.ExternalJobUncheckedCreateInput {
  const confidences = computeConfidences({ ...job, lastSeenAt: now });
  return {
    source: job.source,
    sourceJobId: job.sourceJobId,
    title: job.title,
    company: job.company,
    location: job.location ?? null,
    countryCodes: job.countryCodes ?? [],
    locationRestrictions: job.locationRestrictions ?? [],
    timezoneRestrictions: job.timezoneRestrictions ?? [],
    remoteType: job.remoteType ?? null,
    workArrangement: job.workArrangement ?? null,
    employmentType: job.employmentType ?? null,
    seniority: job.seniority ?? null,
    industry: job.industry ?? null,
    category: job.category ?? null,
    skills: job.skills ?? [],
    visaSponsorship: job.visaSponsorship ?? 'UNKNOWN',
    description: job.description ?? null,
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    currency: job.currency ?? 'USD',
    salaryPeriod: job.salaryPeriod ?? null,
    publishedAt: job.publishedAt ?? null,
    expiresAt: job.expiresAt ?? null,
    firstSeenAt: existing ? undefined : now,
    lastSeenAt: now,
    lastVerifiedAt: now,
    closedAt: null,
    status: 'OPEN',
    contentFingerprint: job.contentFingerprint ?? null,
    attribution: job.attribution ?? null,
    attributionUrl: job.attributionUrl ?? null,
    attributionRequired: Boolean(job.attributionRequired),
    allowStructuredData: Boolean(job.allowStructuredData),
    retentionDays: job.retentionDays ?? null,
    listingQuality: confidences.listingQuality,
    sourceConfidence: confidences.sourceConfidence,
    dataConfidence: confidences.dataConfidence,
  };
}

function updateData(job: NormalizedExternalJob, now: Date): Prisma.ExternalJobUpdateInput {
  const data = jobData(job, now, true);
  delete (data as Partial<Prisma.ExternalJobUncheckedCreateInput>).firstSeenAt;
  return data as Prisma.ExternalJobUpdateInput;
}

/**
 * Upsert a source's batch with one read, one bulk insert for new rows and
 * targeted updates only where the fingerprint changed. This keeps a daily sync
 * with tens of thousands of listing checks within a small write budget.
 */
export async function persistSourceJobs(sourceId: string, rawJobs: NormalizedExternalJob[]): Promise<PersistResult> {
  const { jobs, discarded } = dedupeExternalJobs(rawJobs);
  if (jobs.length === 0) {
    return { created: 0, updated: 0, touched: 0, duplicatesDiscarded: discarded, accepted: 0 };
  }

  const now = new Date();
  const ids = jobs.map((job) => job.sourceJobId);
  const existing = await prisma.externalJob.findMany({
    where: { source: sourceId, sourceJobId: { in: ids } },
    select: { id: true, sourceJobId: true, contentFingerprint: true },
  });
  const existingByKey = new Map(existing.map((row) => [row.sourceJobId, row]));
  const creates: Prisma.ExternalJobCreateManyInput[] = [];
  const updates: Array<{ id: string; job: NormalizedExternalJob }> = [];
  const touchedIds: string[] = [];

  for (const job of jobs) {
    const match = existingByKey.get(job.sourceJobId);
    if (!match) {
      creates.push(jobData(job, now, false));
      continue;
    }
    touchedIds.push(match.id);
    if (match.contentFingerprint !== job.contentFingerprint) {
      updates.push({ id: match.id, job });
    }
  }

  let created = 0;
  for (let index = 0; index < creates.length; index += 500) {
    const result = await prisma.externalJob.createMany({
      data: creates.slice(index, index + 500),
      skipDuplicates: true,
    });
    created += result.count;
  }

  let updated = 0;
  for (let index = 0; index < updates.length; index += 25) {
    const chunk = updates.slice(index, index + 25);
    await prisma.$transaction(
      chunk.map((entry) =>
        prisma.externalJob.update({
          where: { id: entry.id },
          data: updateData(entry.job, now),
        }),
      ),
    );
    updated += chunk.length;
  }

  // Unchanged listings still need their freshness signal updated in one write.
  if (touchedIds.length > 0) {
    for (let index = 0; index < touchedIds.length; index += 1_000) {
      await prisma.externalJob.updateMany({
        where: { id: { in: touchedIds.slice(index, index + 1_000) } },
        data: {
          status: 'OPEN',
          closedAt: null,
          lastSeenAt: now,
          lastVerifiedAt: now,
        },
      });
    }
  }

  return {
    created,
    updated,
    touched: touchedIds.length,
    duplicatesDiscarded: discarded,
    accepted: created + touchedIds.length,
  };
}

/** Close listings that a complete ATS board read no longer returned. */
export async function closeMissingFromBoard(sourceId: string, runStartedAt: Date) {
  const result = await prisma.externalJob.updateMany({
    where: { source: sourceId, status: 'OPEN', lastSeenAt: { lt: runStartedAt } },
    data: { status: 'CLOSED', closedAt: new Date() },
  });
  return result.count;
}

/** Expire listings whose declared deadline passed or whose source went cold. */
export async function closeStaleCatalogueJobs() {
  const now = new Date();
  const coldBefore = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
  const [expired, cold] = await Promise.all([
    prisma.externalJob.updateMany({
      where: { status: 'OPEN', expiresAt: { lt: now } },
      data: { status: 'CLOSED', closedAt: now },
    }),
    prisma.externalJob.updateMany({
      where: { status: 'OPEN', lastSeenAt: { lt: coldBefore } },
      data: { status: 'CLOSED', closedAt: now },
    }),
  ]);
  return expired.count + cold.count;
}
