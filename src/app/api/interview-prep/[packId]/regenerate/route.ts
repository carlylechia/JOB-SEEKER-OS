/**
 * Refresh the questions of an existing preparation pack.
 *
 *   POST /api/interview-prep/[packId]/regenerate
 *
 * Charged as a new AI operation through the shared aiCredits allowance.
 * Previous questions are deactivated, not deleted: practice attempts stay
 * attached to the question versions they were taken against, and new
 * questions are inserted with an incremented version number.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import { refreshPackQuestions } from '@/lib/interview-prep/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]/regenerate';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

const regenerateSchema = z
  .object({})
  .strict();

type Params = { params: Promise<{ packId: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
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

      const body = regenerateSchema.safeParse({});
      if (!body.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const { packId } = await params;

      let result: Awaited<ReturnType<typeof refreshPackQuestions>>;
      try {
        result = await refreshPackQuestions({
          userId,
          packId,
          route: ROUTE,
        });
      } catch (error) {
        return interviewPrepErrorResponse(error, request);
      }

      return privateNoStore(
        jsonOk(
          {
            outcome: 'COMPLETED',
            pack: result.pack,
            data: result.data,
            creditsConsumed: result.creditsConsumed,
          },
          request,
        ),
      );
    },
    { event: 'interview_prep_regenerate_failed', route: ROUTE },
  );
}
