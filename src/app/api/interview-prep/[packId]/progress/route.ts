/**
 * Real preparation progress for one pack.
 *
 *   GET /api/interview-prep/[packId]/progress
 *
 * Persisted activity only — questions answered, feedback received, last
 * practiced date. No streaks, no badges, no readiness claims.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getPrepProgress } from '@/lib/interview-prep/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]/progress';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

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

      const progress = await getPrepProgress({ userId, packId });
      if (!progress) {
        return apiError('NOT_FOUND', 'Preparation pack not found.', { request });
      }

      return privateNoStore(jsonOk({ progress }, request));
    },
    { event: 'interview_prep_progress_failed', route: ROUTE },
  );
}
