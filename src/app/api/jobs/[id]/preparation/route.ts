/**
 * Preparation status and run creation for one job.
 *
 *   GET  /api/jobs/[id]/preparation  → plan + latest run
 *   POST /api/jobs/[id]/preparation  → create (or reuse) a run
 *
 * Creating a run does NOT call a provider. It writes the durable task rows and
 * returns; the client then advances one task at a time. That separation is what
 * makes the workflow retryable and refresh-safe.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import {
  createPreparationRun,
  getPreparationStatus,
  PreparationJobNotFoundError,
} from '@/lib/application-preparation/service';
import {
  createPreparationRunRequestSchema,
  type CreatePreparationRunRequest,
} from '@/lib/application-preparation/requests';
import { preparationErrorResponse } from '@/lib/application-preparation/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/jobs/[id]/preparation';

type Params = { params: Promise<{ id: string }> };

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

export async function GET(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const rate = applyRateLimit(
        `${ROUTE}:get:${session.user.id}:${getRequestIp(request)}`,
        60,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const { id } = await params;

      try {
        const status = await getPreparationStatus({ userId: session.user.id, jobId: id });
        if (!status) {
          throw new PreparationJobNotFoundError();
        }
        return privateNoStore(jsonOk(status, request));
      } catch (error) {
        const response = preparationErrorResponse(error, request);
        if (response) return response;
        throw error;
      }
    },
    { event: 'application_preparation_status_failed', route: ROUTE },
  );
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
        15,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const body = await readBody(request);
      if (body === null) {
        return apiError('BAD_REQUEST', 'Send a valid JSON body.', { request });
      }

      const parsed = createPreparationRunRequestSchema.safeParse(body);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Choose valid preparation materials.', {
          request,
          meta: { issues: parsed.error.issues.map((issue) => issue.message) },
        });
      }

      const input: CreatePreparationRunRequest = parsed.data;
      const { id } = await params;

      try {
        const result = await createPreparationRun({
          userId: session.user.id,
          jobId: id,
          tasks: input.tasks,
        });

        return privateNoStore(
          jsonOk(
            {
              plan: result.plan,
              run: result.run,
              reused: result.reused,
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
    { event: 'application_preparation_create_failed', route: ROUTE },
  );
}
