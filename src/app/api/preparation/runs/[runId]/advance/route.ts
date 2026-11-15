/**
 * Advance a preparation run.
 *
 *   POST /api/preparation/runs/[runId]/advance
 *
 * Each call executes at most `maxTasks`, but always stops early when the
 * request's wall-clock budget is nearly spent. The task is committed as RUNNING
 * before the provider call, so a page refresh, a second tab or a serverless
 * timeout cannot lose the work that already succeeded. Successful siblings are
 * never re-executed on retry.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { advanceUntilIdle } from '@/lib/application-preparation/service';
import { advancePreparationRunRequestSchema } from '@/lib/application-preparation/requests';
import { preparationErrorResponse } from '@/lib/application-preparation/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The deadline below stops new tasks well before this deployment limit; the
// client makes the next call after this one returns.
export const maxDuration = 60;

/**
 * Hard wall-clock budget for task execution, leaving 10 seconds for cold start,
 * auth, the final transaction and the response inside the 60-second function.
 */
const ADVANCE_BUDGET_MS = 50_000;

const ROUTE = '/api/preparation/runs/[runId]/advance';

type Params = { params: Promise<{ runId: string }> };

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
  const startedAt = Date.now();

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

      const body = await readBody(request);
      if (body === null) {
        return apiError('BAD_REQUEST', 'Send a valid JSON body.', { request });
      }

      const parsed = advancePreparationRunRequestSchema.safeParse(body);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const { runId } = await params;

      try {
        const result = await advanceUntilIdle({
          userId: session.user.id,
          runId,
          route: `/api/preparation/runs/${runId}/advance`,
          maxTasks: parsed.data.maxTasks ?? 1,
          deadlineAt: startedAt + ADVANCE_BUDGET_MS,
        });
        return privateNoStore(
          jsonOk(
            {
              run: result.run,
              executed: result.executed,
              retryScheduled: result.retryScheduled,
            },
            request,
          ),
        );
      } catch (error) {
        const response = preparationErrorResponse(error, request);
        if (response) return response;
        throw error;
      }
    },
    { event: 'application_preparation_advance_failed', route: ROUTE },
  );
}
