/**
 * Regenerate an existing preparation pack.
 *
 *   POST /api/interview-prep/[packId]/regenerate
 *
 * Charged as a new AI operation through the shared aiCredits allowance.
 * Previous questions are deactivated, not deleted: practice attempts stay
 * attached to the question versions they were taken against.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import { generatePrepPack } from '@/lib/interview-prep/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]/regenerate';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

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

      const { packId } = await params;

      let result: Awaited<ReturnType<typeof generatePrepPack>>;
      try {
        result = await generatePrepPack({
          userId,
          packId,
          force: true,
          route: ROUTE,
        });
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
    { event: 'interview_prep_regenerate_failed', route: ROUTE },
  );
}
