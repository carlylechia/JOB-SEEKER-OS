/**
 * Restart one preparation step.
 *
 *   POST /api/preparation/runs/[runId]/tasks/[taskId]/retry
 *
 * Only that row is reset. Completed siblings keep their result, so a single
 * broken provider call never costs the rest of the run. The client calls the
 * advance endpoint afterwards; this route never calls a provider itself.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { retryPreparationTask } from '@/lib/application-preparation/service';
import { preparationErrorResponse } from '@/lib/application-preparation/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/preparation/runs/[runId]/tasks/[taskId]/retry';

type Params = { params: Promise<{ runId: string; taskId: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const rate = applyRateLimit(
        `${ROUTE}:post:${session.user.id}:${getRequestIp(request)}`,
        30,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const { runId, taskId } = await params;

      try {
        const run = await retryPreparationTask({
          userId: session.user.id,
          runId,
          taskId,
        });
        return privateNoStore(jsonOk({ run }, request));
      } catch (error) {
        const response = preparationErrorResponse(error, request);
        if (response) return response;
        throw error;
      }
    },
    { event: 'application_preparation_task_retry_failed', route: ROUTE },
  );
}
