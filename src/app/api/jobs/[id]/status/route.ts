import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { mapDbJob } from '@/lib/db-helpers';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { z } from 'zod';

const schema = z.object({
  status: z.enum(['LEAD', 'SAVED', 'APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED']),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const { id } = await params;

  try {
    const existing = await prisma.jobLead.findFirst({ where: { id, userId: session.user.id, deletedAt: null } });
    if (!existing) return jsonError('Job not found', 404, undefined, request);

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return jsonError('Invalid status', 422, undefined, request);

    const updated = await prisma.jobLead.update({
      where: { id },
      data: {
        status: parsed.data.status,
        dateApplied:
          parsed.data.status === 'APPLIED' && !existing.dateApplied ? new Date() : existing.dateApplied,
      },
    });

    await logImportantInfo({
      event: 'job_status_changed',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/status`,
      context: { from: existing.status, to: parsed.data.status },
    });

    return jsonOk({ job: mapDbJob(updated) }, request);
  } catch (error) {
    await logImportantError({
      event: 'job_status_change_failed',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/status`,
      error,
    });
    return jsonError('Unable to update status', 500, undefined, request);
  }
}
