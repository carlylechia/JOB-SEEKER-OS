/**
 * Record an application attempt.
 *
 *   POST /api/jobs/[id]/application/attempt
 *
 * A user's "I applied" creates an ATTEMPTED record and leaves the application
 * IN_PROGRESS. Only a CONFIRMED attempt with an evidence kind moves it to
 * APPLIED; the server stamps the attempt time.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { recordAttempt } from '@/lib/applications/service';
import {
  recordAttemptRequestSchema,
  type RecordAttemptRequest,
} from '@/lib/applications/requests';
import { applicationErrorResponse } from '@/lib/applications/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/jobs/[id]/application/attempt';

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const rate = applyRateLimit(
        `${ROUTE}:post:${session.user.id}:${getRequestIp(request)}`,
        30,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const parsed = recordAttemptRequestSchema.safeParse(await request.json());
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That attempt was not valid.', {
          request,
          meta: { issues: parsed.error.issues.map((issue) => issue.message) },
        });
      }

      const { id } = await params;
      const input: RecordAttemptRequest = parsed.data;

      try {
        const result = await recordAttempt({
          userId: session.user.id,
          jobId: id,
          channel: input.channel,
          status: input.status,
          evidenceKind: input.evidenceKind ?? null,
          evidenceRef: input.evidenceRef ?? null,
          evidenceSummary: input.evidenceSummary ?? null,
          reason: input.reason ?? null,
        });
        return privateNoStore(jsonOk(result, request));
      } catch (error) {
        const response = applicationErrorResponse(error, request);
        if (response) return response;
        throw error;
      }
    },
    { event: 'application_attempt_failed', route: ROUTE },
  );
}
