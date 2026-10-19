/**
 * One question inside a preparation pack, plus the caller's latest attempt.
 *
 *   GET  /api/interview-prep/[packId]/questions/[questionId] -> question + attempt
 *   POST /api/interview-prep/[packId]/questions/[questionId] -> submit a draft
 *                                                              answer (new
 *                                                              numbered attempt,
 *                                                              not metered)
 *
 * Submitting an answer is the user's own writing and costs nothing. Feedback
 * is a separate, metered operation.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import {
  getQuestionForPractice,
  submitPracticeAnswer,
  type PracticeAttempt,
} from '@/lib/interview-prep/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]/questions/[questionId]';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

const submitSchema = z
  .object({
    answer: z.string().max(3000),
  })
  .strict();

type Params = { params: Promise<{ packId: string; questionId: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
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

      const { packId, questionId } = await params;

      const result = await getQuestionForPractice({ userId, packId, questionId });
      if (!result) {
        return apiError('NOT_FOUND', 'Question not found.', { request });
      }

      return privateNoStore(jsonOk({ question: result.question, attempt: result.attempt }, request));
    },
    { event: 'interview_prep_get_question_failed', route: ROUTE },
  );
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

      const { packId, questionId } = await params;

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        // No body → validation fails below.
      }

      const parsed = submitSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      let attempt: PracticeAttempt;
      try {
        attempt = await submitPracticeAnswer({
          userId,
          packId,
          questionId,
          answer: parsed.data.answer,
        });
      } catch (error) {
        return interviewPrepErrorResponse(error, request);
      }

      return privateNoStore(jsonOk({ attempt }, request));
    },
    { event: 'interview_prep_submit_answer_failed', route: ROUTE },
  );
}
