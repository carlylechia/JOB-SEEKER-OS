/**
 * Regenerate a cover letter with the same inputs.
 *
 *   POST /api/cover-letters/[letterId]/regenerate
 *
 * Charged as a new AI operation through the shared aiCredits allowance.
 * The previous letter is preserved: a new versioned row is created so the
 * user can compare versions rather than silently losing the earlier draft.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { coverLetterErrorResponse } from '@/lib/cover-letter/route-errors';
import { regenerateCoverLetter } from '@/lib/cover-letter/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/cover-letters/[letterId]/regenerate';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

const regenerateSchema = z.object({}).strict();

type Params = { params: Promise<{ letterId: string }> };

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

      const { letterId } = await params;

      let result: Awaited<ReturnType<typeof regenerateCoverLetter>>;
      try {
        result = await regenerateCoverLetter({ userId, letterId, route: ROUTE });
      } catch (error) {
        return coverLetterErrorResponse(error, request);
      }

      return privateNoStore(
        jsonOk(
          {
            outcome: 'COMPLETED',
            letter: result.letter,
            data: result.data,
            creditsConsumed: result.creditsConsumed,
          },
          request,
        ),
      );
    },
    { event: 'cover_letter_regenerate_failed', route: ROUTE },
  );
}
