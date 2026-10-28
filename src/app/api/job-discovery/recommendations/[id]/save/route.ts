import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { hasEntitlement } from '@/lib/billing/subscriptions';
import { buildStoredJobPayload, getUserPreferences } from '@/lib/db-helpers';
import { mapDbJob } from '@/lib/db-helpers';
import { isSafeExternalUrl } from '@/lib/url';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantError, logImportantInfo } from '@/lib/observability';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);
  const userId = session.user.id;
  const { id } = await params;

  try {
    await hasEntitlement(userId, 'DAILY_JOB_DISCOVERY');
  } catch {
    return jsonError('Plan required', 403, undefined, request);
  }

  try {
    const rec = await prisma.dailyJobRecommendation.findFirst({
    where: { id, userId },
    include: { externalJob: true },
  });
  if (!rec) return jsonError('Recommendation not found', 404, undefined, request);

  const ext = rec.externalJob;
  const applicationUrl = ext.applicationUrl || ext.canonicalUrl;
  if (!applicationUrl || !isSafeExternalUrl(applicationUrl)) {
    return jsonError('No verified application URL', 422, undefined, request);
  }

  // Dedup: company+title or jobUrl
  const existing = await prisma.jobLead.findFirst({
    where: {
      userId,
      OR: [
        { jobUrl: applicationUrl },
        { company: ext.company, title: ext.title },
      ],
    },
  });

  if (existing) {
    if (rec.status !== 'SAVED') {
      await prisma.dailyJobRecommendation.update({ where: { id: rec.id }, data: { status: 'SAVED' } });
    }
    await logImportantInfo({ event: 'recommended_job_imported', userId, jobId: existing.id, context: { recommendationId: id, duplicate: true } });
    return jsonOk({ ok: true, jobId: existing.id, duplicate: true }, request);
  }

  const preferences = await getUserPreferences(userId);
  const inferredScore = rec.scoreBreakdown ?? {};

  const jobPayload = buildStoredJobPayload(
    {
      company: ext.company,
      title: ext.title,
      source: ext.source,
      jobUrl: applicationUrl,
      location: ext.location ?? '',
      remoteType: ext.remoteType ?? '',
      timezoneRequirement: ext.timezoneRestrictions?.length
        ? ext.timezoneRestrictions.map((t) => `UTC${t >= 0 ? '+' : ''}${t}`).join(', ')
        : '',
      eligibilityRegion: ext.countryCodes?.length ? ext.countryCodes.join(', ') : '',
      salaryMin: ext.salaryMin ?? '',
      salaryMax: ext.salaryMax ?? '',
      currency: ext.currency ?? 'USD',
      notes: ext.attribution
        ? ext.attributionUrl
          ? `${ext.attribution} (${ext.attributionUrl})`
          : ext.attribution
        : '',
      jobDescription: ext.description ?? '',
      status: 'LEAD',
      dateFound: new Date().toISOString().slice(0, 10),
      coreStackMatch: (inferredScore as any)?.coreStackMatch ?? 3,
      roleAlignment: (inferredScore as any)?.roleAlignment ?? 3,
      seniorityFit: (inferredScore as any)?.seniorityFit ?? 3,
      geographyEligibility: (inferredScore as any)?.geographyEligibility ?? 3,
      timezoneCompatibility: (inferredScore as any)?.timezoneCompatibility ?? 3,
      compensationFit: (inferredScore as any)?.compensationFit ?? 3,
      domainRelevance: (inferredScore as any)?.domainRelevance ?? 3,
      applicationFriction: (inferredScore as any)?.applicationFriction ?? 3,
      signalQuality: (inferredScore as any)?.signalQuality ?? 3,
    },
    preferences,
  );

  const created = await prisma.jobLead.create({
    data: {
      userId,
      company: jobPayload.company,
      title: jobPayload.title,
      source: jobPayload.source,
      jobUrl: jobPayload.jobUrl ?? null,
      location: jobPayload.location,
      remoteType: jobPayload.remoteType,
      timezoneRequirement: jobPayload.timezoneRequirement,
      eligibilityRegion: jobPayload.eligibilityRegion,
      salaryMin: jobPayload.salaryMin ?? null,
      salaryMax: jobPayload.salaryMax ?? null,
      currency: jobPayload.currency,
      notes: jobPayload.notes,
      jobDescription: jobPayload.jobDescription,
      status: jobPayload.status,
      dateFound: new Date(jobPayload.dateFound),
      priorityFlag: jobPayload.priorityFlag,
      score: jobPayload.score,
      checklist: jobPayload.checklist,
      contacts: jobPayload.contacts,
      interviews: jobPayload.interviews,
      prepPack: jobPayload.prepPack,
    },
  });

  await prisma.dailyJobRecommendation.update({ where: { id: rec.id }, data: { status: 'SAVED' } });

  await logImportantInfo({ event: 'recommended_job_imported', userId, jobId: created.id, context: { recommendationId: id } });

  return jsonOk({ ok: true, jobId: created.id, duplicate: false }, request);
} catch (error) {
  await logImportantError({ event: 'recommended_job_import_failed', userId, error, context: { recommendationId: id } });
  return jsonError('Unable to save job', 500, undefined, request);
}
}
