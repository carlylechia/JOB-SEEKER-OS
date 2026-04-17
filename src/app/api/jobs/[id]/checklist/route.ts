import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { mapDbJob } from '@/lib/db-helpers';
import { logImportantInfo, logImportantError } from '@/lib/observability';
import { z } from 'zod';

const checklistSchema = z.object({
  resumeTailored:      z.boolean(),
  pdfChecked:          z.boolean(),
  coverLetterReady:    z.boolean(),
  portfolioAdded:      z.boolean(),
  videoDone:           z.boolean(),
  compensationChecked: z.boolean(),
  eligibilityChecked:  z.boolean(),
  submitted:           z.boolean(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const { id } = await params;
  const rate = applyRateLimit(`jobs:checklist:${session.user.id}:${getRequestIp(request)}`, 60, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const job = await prisma.jobLead.findFirst({ where: { id, userId: session.user.id, deletedAt: null } });
    if (!job) return jsonError('Job not found', 404, undefined, request);

    const body = await request.json();
    const parsed = checklistSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid checklist', 422, parsed.error.issues.map((i) => i.message), request);
    }

    const updated = await prisma.jobLead.update({
      where: { id },
      data: { checklist: parsed.data },
    });

    await logImportantInfo({
      event: 'checklist_updated',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/checklist`,
      context: { checklist: parsed.data },
    });

    return jsonOk({ job: mapDbJob(updated) }, request);
  } catch (error) {
    await logImportantError({
      event: 'checklist_update_failed',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/checklist`,
      error,
    });
    return jsonError('Unable to update checklist.', 500, undefined, request);
  }
}
