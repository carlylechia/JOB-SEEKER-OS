import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { buildStoredJobPayload, getUserPreferences, mapDbJob } from '@/lib/db-helpers';
import { handleOptions } from '@/lib/cors';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);
  const { id } = await params;
  const rate = applyRateLimit(`public-job:save:${session.user.id}:${getRequestIp(request)}`, 20, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const sourceJob = await prisma.jobLead.findUnique({ where: { id } });
    if (!sourceJob) return jsonError('Public job not found', 404, undefined, request);

    const existing = await prisma.jobLead.findFirst({ where: { userId: session.user.id, company: sourceJob.company, title: sourceJob.title, jobUrl: sourceJob.jobUrl } });
    if (existing) return jsonOk({ job: mapDbJob(existing) }, request);

    const preferences = await getUserPreferences(session.user.id);
    const payload = buildStoredJobPayload({ ...mapDbJob(sourceJob), checklist: sourceJob.checklist, contacts: [], interviews: [], prepPack: sourceJob.prepPack }, preferences);
    const created = await prisma.jobLead.create({
      data: {
        userId: session.user.id,
        company: payload.company,
        title: payload.title,
        source: payload.source,
        jobUrl: payload.jobUrl || null,
        location: payload.location,
        remoteType: payload.remoteType,
        timezoneRequirement: payload.timezoneRequirement,
        eligibilityRegion: payload.eligibilityRegion,
        salaryMin: payload.salaryMin ?? null,
        salaryMax: payload.salaryMax ?? null,
        currency: payload.currency,
        notes: payload.notes,
        status: 'SAVED',
        dateFound: new Date(payload.dateFound),
        nextFollowUp: payload.nextFollowUp ? new Date(payload.nextFollowUp) : null,
        priorityFlag: payload.priorityFlag,
        score: payload.score,
        checklist: payload.checklist,
        contacts: [],
        interviews: [],
        prepPack: payload.prepPack,
      },
    });

    await logImportantInfo({ event: 'public_job_saved', userId: session.user.id, jobId: created.id, route: `/api/public-jobs/${id}/save` });
    return jsonOk({ job: mapDbJob(created) }, request, { status: 201 });
  } catch (error) {
    await logImportantError({ event: 'public_job_save_failed', userId: session.user.id, route: `/api/public-jobs/${id}/save`, error, context: { method: 'POST' } });
    return jsonError('Unable to save this public job.', 500, undefined, request);
  }
}
