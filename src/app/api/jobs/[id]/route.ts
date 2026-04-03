import { auth } from '@/auth';
import { buildStoredJobPayload, getUserPreferences, mapDbJob } from '@/lib/db-helpers';
import { handleOptions } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import { jobPayloadSchema } from '@/lib/job-schema';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantError, logImportantInfo } from '@/lib/observability';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const { id } = await params;
  const job = await prisma.jobLead.findFirst({ where: { id, userId: session.user.id } });
  if (!job) return jsonError('Job not found', 404, undefined, request);

  return jsonOk({ job: mapDbJob(job) }, request);
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const { id } = await params;
  const rate = applyRateLimit(`jobs:update:${session.user.id}:${getRequestIp(request)}`, 30, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const existing = await prisma.jobLead.findFirst({ where: { id, userId: session.user.id } });
    if (!existing) return jsonError('Job not found', 404, undefined, request);

    const body = await request.json();
    const parsed = jobPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid job payload', 422, parsed.error.issues.map((issue) => issue.message), request);
    }

    const preferences = await getUserPreferences(session.user.id);
    const job = buildStoredJobPayload({ ...parsed.data, id, checklist: existing.checklist, contacts: existing.contacts, interviews: existing.interviews, prepPack: existing.prepPack, dateFound: existing.dateFound.toISOString().slice(0,10) }, preferences);

    const updated = await prisma.jobLead.update({
      where: { id },
      data: {
        company: job.company,
        title: job.title,
        source: job.source,
        jobUrl: job.jobUrl || null,
        location: job.location,
        remoteType: job.remoteType,
        timezoneRequirement: job.timezoneRequirement,
        eligibilityRegion: job.eligibilityRegion,
        salaryMin: job.salaryMin ?? null,
        salaryMax: job.salaryMax ?? null,
        currency: job.currency,
        notes: job.notes,
        status: job.status,
        dateApplied: job.dateApplied ? new Date(job.dateApplied) : null,
        nextFollowUp: job.nextFollowUp ? new Date(job.nextFollowUp) : null,
        priorityFlag: job.priorityFlag,
        score: job.score,
      },
    });

    await logImportantInfo({ event: 'job_updated', userId: session.user.id, jobId: id, route: `/api/jobs/${id}`, context: { status: updated.status } });
    return jsonOk({ job: mapDbJob(updated) }, request);
  } catch (error) {
    await logImportantError({ event: 'job_update_failed', userId: session.user.id, jobId: id, route: `/api/jobs/${id}`, error });
    return jsonError('Unable to update job lead', 500, undefined, request);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const { id } = await params;
  const rate = applyRateLimit(`jobs:delete:${session.user.id}:${getRequestIp(request)}`, 10, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const job = await prisma.jobLead.findFirst({ where: { id, userId: session.user.id } });
    if (!job) return jsonError('Job not found', 404, undefined, request);

    await prisma.jobLead.delete({ where: { id } });
    await logImportantInfo({ event: 'job_deleted', userId: session.user.id, jobId: id, route: `/api/jobs/${id}`, context: { company: job.company, title: job.title } });
    return jsonOk({ ok: true }, request);
  } catch (error) {
    await logImportantError({ event: 'job_delete_failed', userId: session.user.id, jobId: id, route: `/api/jobs/${id}`, error });
    return jsonError('Unable to delete job lead', 500, undefined, request);
  }
}
