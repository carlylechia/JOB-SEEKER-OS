/**
 * Stop a preparation run.
 *
 *   POST /api/preparation/runs/[runId]/cancel
 *
 * Cancellation is durable and idempotent. It marks every unfinished task as
 * CANCELLED and the run as CANCELLED; completed work is never deleted. A
 * provider call that is already in flight is ignored when it returns, so the
 * run cannot silently come back to life after the user stopped it.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { cancelPreparationRun } from '@/lib/application-preparation/service';
import { preparationErrorResponse } from '@/lib/application-preparation/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/preparation/runs/[runId]/cancel';

type Params = { params: Promise<{ runId: string }> };

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

      const { runId } = await params;

      try {
        const run = await cancelPreparationRun({
          userId: session.user.id,
          runId,
        });
        return privateNoStore(jsonOk({ run }, request));
      } catch (error) {
        const response = preparationErrorResponse(error, request);
        if (response) return response;
        throw error;
      }
    },
    { event: 'application_preparation_cancel_failed', route: ROUTE },
  );
}
