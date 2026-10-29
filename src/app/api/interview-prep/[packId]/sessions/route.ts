/**
 * Start a mock interview session.
 *
 *   POST /api/interview-prep/[packId]/sessions
 *
 * A session is a server-selected, persisted sequence of questions. Creating a
 * session costs nothing; answer feedback remains the metered operation.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import { createPracticeSession, getPrepPack } from '@/lib/interview-prep/service';
import { practiceModeSchema } from '@/lib/interview-prep/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]/sessions';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

const createSchema = z.object({ mode: practiceModeSchema }).strict();

type Params = { params: Promise<{ packId: string }> };

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

      const { packId } = await params;
      const detail = await getPrepPack({ userId, packId });
      if (!detail) {
        return apiError('NOT_FOUND', 'Preparation pack not found.', { request });
      }

      return privateNoStore(jsonOk({ sessions: detail.sessions }, request));
    },
    { event: 'interview_prep_sessions_list_failed', route: ROUTE },
  );
}

export async function POST(request: Request, { params }: Params) {
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

      const parsed = createSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const { packId } = await params;

      let practiceSession: Awaited<ReturnType<typeof createPracticeSession>>;
      try {
        practiceSession = await createPracticeSession({
          userId,
          packId,
          mode: parsed.data.mode,
        });
      } catch (error) {
        return interviewPrepErrorResponse(error, request);
      }

      return privateNoStore(jsonOk({ session: practiceSession }, request));
    },
    { event: 'interview_prep_session_create_failed', route: ROUTE },
  );
}
