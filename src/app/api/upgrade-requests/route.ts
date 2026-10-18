/**
 * POST /api/upgrade-requests  — create an upgrade request
 * GET  /api/upgrade-requests  — the caller's own request history
 *
 * SECURITY:
 *   - requires authentication
 *   - `userId` is derived from the SESSION, never from the body
 *   - body is validated with Zod in strict mode, so unknown fields such as
 *     `userId`, `status` or `role` are rejected outright
 *   - a user can never set the request status; only admins can
 *   - duplicate open requests are refused with 409 rather than duplicated
 */

import { z } from 'zod';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { getCurrentUser } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { upgradeRequestSchema } from '@/lib/billing/upgrade-requests';
import {
  createUpgradeRequest,
  cancelOwnUpgradeRequest,
  DuplicateRequestError,
} from '@/lib/billing/upgrade-request-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return privateNoStore(apiError('UNAUTHENTICATED', 'Please sign in.', { request }));
  }

  const requests = await prisma.upgradeRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      requestedPlan: true,
      status: true,
      contactMethod: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  return privateNoStore(jsonOk({ requests }, request));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return apiError('UNAUTHENTICATED', 'Please sign in to request an upgrade.', { request });
  }

  // Rate limit per user AND per IP.
  const byUser = applyRateLimit(`upgrade-request:${user.id}`, 5, 60 * 60 * 1000);
  const byIp = applyRateLimit(`upgrade-request-ip:${getRequestIp(request)}`, 10, 60 * 60 * 1000);
  if (!byUser.ok || !byIp.ok) {
    return apiError(
      'RATE_LIMITED',
      'You have submitted several requests recently. Please wait before trying again.',
      { request },
    );
  }

  return handleRoute(
    async () => {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return apiError('BAD_REQUEST', 'Invalid request body.', { request });
      }

      const parsed = upgradeRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Please check the form and try again.', {
          request,
          meta: { details: parsed.error.issues.map((i) => i.message).slice(0, 5) },
        });
      }

      try {
        const created = await createUpgradeRequest({
          // Session-derived identity. The client cannot influence this.
          userId: user.id,
          input: parsed.data,
        });

        return jsonOk(
          {
            ok: true,
            message: 'Your upgrade request has been received.',
            request: created,
          },
          request,
          { status: 201 },
        );
      } catch (error) {
        if (error instanceof DuplicateRequestError) {
          return apiError(
            'DUPLICATE_REQUEST',
            'You already have an upgrade request in progress. Our team is reviewing it.',
            { request, meta: { requestId: error.existingRequestId, status: error.existingStatus } },
          );
        }
        throw error;
      }
    },
    { event: 'upgrade_request_create_failed', route: '/api/upgrade-requests', userId: user.id },
  );
}

const cancelSchema = z.object({ requestId: z.string().min(1).max(64) });

/** DELETE /api/upgrade-requests — withdraw the caller's own open request. */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
  }

  return handleRoute(
    async () => {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return apiError('BAD_REQUEST', 'Invalid request body.', { request });
      }

      const parsed = cancelSchema.safeParse(raw);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'A valid requestId is required.', { request });
      }

      try {
        // Ownership is enforced inside the service against the session user.
        await cancelOwnUpgradeRequest({ userId: user.id, requestId: parsed.data.requestId });
        return jsonOk({ ok: true }, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        // Never reveal whether someone else's request exists.
        if (message.includes('not found')) {
          return apiError('NOT_FOUND', 'Upgrade request not found.', { request });
        }
        return apiError('CONFLICT', message || 'This request can no longer be cancelled.', { request });
      }
    },
    { event: 'upgrade_request_cancel_failed', route: '/api/upgrade-requests', userId: user.id },
  );
}