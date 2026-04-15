import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getUserPreferences, mapDbJob } from '@/lib/db-helpers';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantInfo, logImportantError } from '@/lib/observability';
import { calculateFitScore, calculateFitTier, calculatePriority } from '@/lib/scoring';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rl = applyRateLimit(`rescore:${session.user.id}:${getRequestIp(request)}`, 20, 60_000);
  if (!rl.ok) return jsonError('Too many requests', 429, undefined, request);

  const { id } = await params;

  try {
    const existing = await prisma.jobLead.findFirst({
      where: { id, userId: session.user.id, deletedAt: null },
    });
    if (!existing) return jsonError('Job not found', 404, undefined, request);

    const preferences = await getUserPreferences(session.user.id);
    const job = mapDbJob(existing);

    const fitScore = calculateFitScore(job, preferences);
    const fitTier = calculateFitTier(fitScore);
    const newScore = { ...job.score, fitScore, fitTier };
    const tempJobForPriority = { ...job, score: newScore };
    const priorityFlag = calculatePriority(tempJobForPriority);

    const updated = await prisma.jobLead.update({
      where: { id },
      data: {
        score: newScore,
        priorityFlag,
      },
    });

    await logImportantInfo({
      event: 'job_rescored',
      userId: session.user.id,
      jobId: id,
      context: { fitScore, fitTier, priorityFlag },
    });

    return jsonOk({ job: mapDbJob(updated) });
  } catch (error) {
    await logImportantError({
      event: 'job_rescore_failed',
      userId: session.user.id,
      jobId: id,
      error,
    });
    return jsonError('Unable to rescore job', 500, undefined, request);
  }
}
