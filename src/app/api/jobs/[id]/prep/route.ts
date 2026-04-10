import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { mapDbJob } from '@/lib/db-helpers';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { sanitizeText } from '@/lib/sanitize';
import { z } from 'zod';

const prepSchema = z.object({
  whyThisRole: z.string().max(5000).default('').transform((v) => sanitizeText(v, 5000)),
  topFitPoints: z.string().max(5000).default('').transform((v) => sanitizeText(v, 5000)),
  likelyQuestions: z.string().max(5000).default('').transform((v) => sanitizeText(v, 5000)),
  questionsToAsk: z.string().max(5000).default('').transform((v) => sanitizeText(v, 5000)),
  technicalFocus: z.string().max(5000).default('').transform((v) => sanitizeText(v, 5000)),
  companyResearchLinks: z.string().max(5000).default('').transform((v) => sanitizeText(v, 5000)),
  prepScore: z.coerce.number().min(0).max(100).default(0),
  prepStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'READY']).default('NOT_STARTED'),
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
    const parsed = prepSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid prep pack data', 422, parsed.error.issues.map((i) => i.message), request);
    }

    const updated = await prisma.jobLead.update({
      where: { id },
      data: { prepPack: parsed.data },
    });

    await logImportantInfo({
      event: 'prep_pack_updated',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/prep`,
      context: { prepStatus: parsed.data.prepStatus },
    });

    return jsonOk({ job: mapDbJob(updated) }, request);
  } catch (error) {
    await logImportantError({
      event: 'prep_pack_update_failed',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/prep`,
      error,
    });
    return jsonError('Unable to update prep pack', 500, undefined, request);
  }
}
