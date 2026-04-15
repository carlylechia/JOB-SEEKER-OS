import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { mapDbJob } from '@/lib/db-helpers';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { z } from 'zod';

const schema = z.object({
  nextFollowUp: z.string().nullable().optional(),
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
    if (!parsed.success) return jsonError('Invalid payload', 422, undefined, request);

    const nextFollowUp = parsed.data.nextFollowUp
      ? new Date(parsed.data.nextFollowUp)
      : null;

    const updated = await prisma.jobLead.update({
      where: { id },
      data: { nextFollowUp },
    });

    await logImportantInfo({
      event: 'job_followup_updated',
      userId: session.user.id,
      jobId: id,
      context: { nextFollowUp: parsed.data.nextFollowUp },
    });

    return jsonOk({ job: mapDbJob(updated) }, request);
  } catch (error) {
    await logImportantError({
      event: 'job_followup_update_failed',
      userId: session.user.id,
      jobId: id,
      error,
    });
    return jsonError('Unable to update follow-up date', 500, undefined, request);
  }
}
