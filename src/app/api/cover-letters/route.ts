/**
 * Cover letters API.
 *
 *   GET  /api/cover-letters  -> list the caller's letters (optionally ?jobId=)
 *                                with entitlement metadata
 *   POST /api/cover-letters  -> create (or reuse) a job-specific cover letter,
 *                                metered through the shared aiCredits allowance
 *
 * Every response is scoped by the session. There is no `userId` parameter
 * anywhere in this file, so there is nothing for a caller to swap — and the
 * job id is resolved ownership-scoped inside the service layer, so another
 * user's job is a 404 rather than a 403.
 *
 * Reading a saved letter never consumes AI credits. Only generating a letter
 * is metered.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { COVER_LETTER_FEATURE } from '@/lib/cover-letter/service';
import { coverLetterErrorResponse } from '@/lib/cover-letter/route-errors';
import { type RunCoverLetterResult } from '@/lib/cover-letter/service';
import {
  buildLetterInputs,
  getLetterWithClaims,
  listCoverLetters,
  runCoverLetterGeneration,
  type RunCoverLetterOptions,
} from '@/lib/cover-letter/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/cover-letters';

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

      const letters = await listCoverLetters({ userId, jobId });

      return privateNoStore(
        jsonOk(
          {
            letters,
            access: {
              canGenerate: entitlements.features[COVER_LETTER_FEATURE],
              plan: entitlements.plan,
              aiCreditsRemaining: entitlements.limits.aiCredits,
            },
          },
          request,
        ),
      );
    },
    { event: 'cover_letter_list_failed', route: ROUTE },
  );
}

const createSchema = z
  .object({
    jobId: z.string().min(1),
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
        // A body is required here: caller must name the job.
      }

      const parsed = createSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const options: RunCoverLetterOptions = {
        userId,
        jobId: parsed.data.jobId,
        force: parsed.data.force === true,
        route: ROUTE,
      };

      let result: RunCoverLetterResult;
      try {
        result = await runCoverLetterGeneration(options);
      } catch (error) {
        return coverLetterErrorResponse(error, request);
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
            letter: result.letter,
            data: result.data,
            ...(result.outcome === 'COMPLETED' ? { creditsConsumed: result.creditsConsumed } : {}),
          },
          request,
        ),
      );
    },
    { event: 'cover_letter_route_failed', route: ROUTE },
  );
}
