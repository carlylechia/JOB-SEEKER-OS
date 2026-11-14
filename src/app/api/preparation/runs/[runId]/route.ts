/**
 * One preparation run.
 *
 *   GET /api/preparation/runs/[runId]
 *
 * Ownership-scoped polling endpoint. It returns only database state; no
 * provider is called here, so polling is free and cannot consume credits.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getPreparationRun } from '@/lib/application-preparation/service';
import { preparationErrorResponse } from '@/lib/application-preparation/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/preparation/runs/[runId]';

type Params = { params: Promise<{ runId: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const rate = applyRateLimit(
        `${ROUTE}:get:${session.user.id}:${getRequestIp(request)}`,
        120,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const { runId } = await params;

      try {
        const run = await getPreparationRun({ userId: session.user.id, runId });
        return privateNoStore(jsonOk({ run }, request));
      } catch (error) {
        const response = preparationErrorResponse(error, request);
        if (response) return response;
        throw error;
      }
    },
    { event: 'application_preparation_run_read_failed', route: ROUTE },
  );
}
