/**
 * Interview preparation packs API.
 *
 *   GET  /api/interview-prep  -> list the caller's packs (optionally ?jobId=)
 *                                with entitlement metadata
 *   POST /api/interview-prep  -> create (or reuse) a job-specific pack,
 *                                metered through the shared aiCredits allowance
 *
 * Every response is scoped by the session. There is no `userId` parameter
 * anywhere in this file, so there is nothing for a caller to swap — and the
 * job id is resolved ownership-scoped inside the service layer, so another
 * user's job is a 404 rather than a 403.
 *
 * Reading a saved pack never consumes AI credits. Only creating or refreshing
 * a pack is metered.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { INTERVIEW_PREP_FEATURE } from '@/lib/interview-prep/service';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import {
  buildPrepInputs,
  getPackWithQuestions,
  listPrepPacks,
  runInterviewPrepGeneration,
  type RunPrepGenerationOptions,
  type RunPrepGenerationResult,
} from '@/lib/interview-prep/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request) {
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

      const entitlements = await getEntitlements(userId);

      const { searchParams } = new URL(request.url);
      const jobId = searchParams.get('jobId') || undefined;

      const packs = await listPrepPacks({ userId, jobId });

      return privateNoStore(
        jsonOk(
          {
            packs,
            access: {
              canGenerate: entitlements.features[INTERVIEW_PREP_FEATURE],
              plan: entitlements.plan,
              aiCreditsRemaining: entitlements.limits.aiCredits,
            },
          },
          request,
        ),
      );
    },
    { event: 'interview_prep_list_failed', route: ROUTE },
  );
}

const createSchema = z
  .object({
    jobId: z.string().min(1),
    context: z.string().default('BALANCED'),
    force: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request) {
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
        // A body is required here: caller must name the job and context.
      }

      const parsed = createSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const options: RunPrepGenerationOptions = {
        userId,
        jobId: parsed.data.jobId,
        context: parsed.data.context,
        force: parsed.data.force === true,
        route: ROUTE,
      };

      let result: RunPrepGenerationResult;
      try {
        result = await runInterviewPrepGeneration(options);
      } catch (error) {
        return interviewPrepErrorResponse(error, request);
      }

      if (result.outcome === 'FAILED') {
        return apiError('AI_UNAVAILABLE', result.message, {
          request,
          meta: { code: result.code, retryable: result.retryable },
        });
      }

      return privateNoStore(
        jsonOk(
          {
            outcome: result.outcome,
            pack: result.pack,
            data: result.data,
            ...(result.outcome === 'COMPLETED' ? { creditsConsumed: result.creditsConsumed } : {}),
          },
          request,
        ),
      );
    },
    { event: 'interview_prep_route_failed', route: ROUTE },
  );
}
