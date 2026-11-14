/**
 * Application lifecycle record for one job.
 *
 *   GET   /api/jobs/[id]/application → application + attempts + events
 *   PATCH /api/jobs/[id]/application → manual status transition
 *
 * A transition to APPLIED is rejected unless a CONFIRMED attempt with evidence
 * already exists for this application.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import {
  getApplication,
  transitionApplication,
  ApplicationNotFoundError,
} from '@/lib/applications/service';
import {
  transitionApplicationRequestSchema,
  type TransitionApplicationRequest,
} from '@/lib/applications/requests';
import { applicationErrorResponse } from '@/lib/applications/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/jobs/[id]/application';

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const rate = applyRateLimit(
        `${ROUTE}:get:${session.user.id}:${getRequestIp(request)}`,
        60,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const { id } = await params;

      try {
        const detail = await getApplication({ userId: session.user.id, jobId: id });
        if (!detail) throw new ApplicationNotFoundError();
        return privateNoStore(jsonOk(detail, request));
      } catch (error) {
        const response = applicationErrorResponse(error, request);
        if (response) return response;
        throw error;
      }
    },
    { event: 'application_read_failed', route: ROUTE },
  );
}

export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const rate = applyRateLimit(
        `${ROUTE}:patch:${session.user.id}:${getRequestIp(request)}`,
        30,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const parsed = transitionApplicationRequestSchema.safeParse(await request.json());
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Choose a valid application status.', {
          request,
          meta: { issues: parsed.error.issues.map((issue) => issue.message) },
        });
      }

      const { id } = await params;
      const input: TransitionApplicationRequest = parsed.data;

      try {
        const application = await transitionApplication({
          userId: session.user.id,
          jobId: id,
          toStatus: input.toStatus,
          reason: input.reason ?? null,
        });
        return privateNoStore(jsonOk({ application }, request));
      } catch (error) {
        const response = applicationErrorResponse(error, request);
        if (response) return response;
        throw error;
      }
    },
    { event: 'application_transition_failed', route: ROUTE },
  );
}
