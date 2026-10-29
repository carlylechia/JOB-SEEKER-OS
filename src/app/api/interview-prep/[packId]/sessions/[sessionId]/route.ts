/**
 * One mock interview session.
 *
 *   GET   /api/interview-prep/[packId]/sessions/[sessionId] -> session, its
 *                                                             questions and answers
 *   PATCH /api/interview-prep/[packId]/sessions/[sessionId] -> complete the run
 *
 * Completing a session is candidate-authored progress and is not metered.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import {
  completePracticeSession,
  getPracticeSession,
} from '@/lib/interview-prep/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]/sessions/[sessionId]';

const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 60_000;

const patchSchema = z.object({ action: z.literal('complete') }).strict();

type Params = { params: Promise<{ packId: string; sessionId: string }> };

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

      const { packId, sessionId } = await params;
      const result = await getPracticeSession({ userId, packId, sessionId });
      if (!result) {
        return apiError('NOT_FOUND', 'Practice session not found.', { request });
      }

      return privateNoStore(jsonOk(result, request));
    },
    { event: 'interview_prep_session_get_failed', route: ROUTE },
  );
}

export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const authSession = await auth();
      if (!authSession?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = authSession.user.id;
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
        // Validation below supplies the error.
      }

      const parsed = patchSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const { packId, sessionId } = await params;
      const completed = await completePracticeSession({ userId, packId, sessionId });
      if (!completed) {
        return apiError('NOT_FOUND', 'Practice session not found.', { request });
      }

      return privateNoStore(jsonOk({ session: completed }, request));
    },
    { event: 'interview_prep_session_complete_failed', route: ROUTE },
  );
}
