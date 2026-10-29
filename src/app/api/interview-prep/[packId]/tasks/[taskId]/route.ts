/**
 * Update one preparation task's status.
 *
 *   PATCH /api/interview-prep/[packId]/tasks/[taskId]
 *
 * Completing a task is candidate-authored progress, not an AI operation, so it
 * is neither metered nor dependent on a current paid plan. Ownership is
 * enforced through the pack in the service layer.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { updateTaskStatus } from '@/lib/interview-prep/service';
import { taskStatusSchema } from '@/lib/interview-prep/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]/tasks/[taskId]';

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const updateSchema = z.object({ status: taskStatusSchema }).strict();

type Params = { params: Promise<{ packId: string; taskId: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        RATE_LIMIT,
        RATE_WINDOW_MS,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        // Validation below supplies the error.
      }

      const parsed = updateSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const { packId, taskId } = await params;
      const task = await updateTaskStatus({
        userId,
        packId,
        taskId,
        status: parsed.data.status,
      });
      if (!task) {
        return apiError('NOT_FOUND', 'Preparation task not found.', { request });
      }

      return privateNoStore(jsonOk({ task }, request));
    },
    { event: 'interview_prep_task_update_failed', route: ROUTE },
  );
}
