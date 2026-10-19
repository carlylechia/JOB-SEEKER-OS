/**
 * Generate feedback for one submitted practice answer.
 *
 *   POST /api/interview-prep/[packId]/attempts/[attemptId]/feedback
 *
 * Metered through the shared aiCredits allowance: evaluating a new answer is
 * a new meaningful AI operation. Re-reading an existing attempt's feedback is
 * free and handled by the question route.
 *
 * The answer must be long enough to evaluate; otherwise a 422 is returned
 * rather than a meaningless score.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import { generatePracticeFeedback } from '@/lib/interview-prep/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]/attempts/[attemptId]/feedback';

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const feedbackSchema = z
  .object({})
  .strict();

type Params = { params: Promise<{ packId: string; attemptId: string }> };

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

      const body = feedbackSchema.safeParse({});
      if (!body.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const { packId, attemptId } = await params;

      let result: Awaited<ReturnType<typeof generatePracticeFeedback>>;
      try {
        result = await generatePracticeFeedback({
          userId,
          packId,
          attemptId,
          route: ROUTE,
        });
      } catch (error) {
        return interviewPrepErrorResponse(error, request);
      }

      return privateNoStore(
        jsonOk(
          {
            attempt: result.attempt,
            feedback: result.feedback,
            creditsConsumed: result.creditsConsumed,
          },
          request,
        ),
      );
    },
    { event: 'interview_prep_feedback_failed', route: ROUTE },
  );
}
