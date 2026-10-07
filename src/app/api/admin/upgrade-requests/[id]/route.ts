/**
 * GET   /api/admin/upgrade-requests/[id] — full request + user context
 * PATCH /api/admin/upgrade-requests/[id] — status change / internal note
 *
 * SECURITY:
 *   - admin-only on both verbs
 *   - the request id comes from the URL; the acting admin from the session
 *   - transitions are validated against the state machine server-side, so two
 *     admins racing cannot double-approve: the loser gets 409
 *   - clients can never set APPROVED/REJECTED/CONTACTED on a public endpoint
 */

import { z } from 'zod';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { getCurrentAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { applyRateLimit } from '@/lib/rate-limit';
import { logImportantInfo } from '@/lib/observability';
import { getEffectiveSubscription } from '@/lib/billing/subscriptions';
import { adminUpdateUpgradeRequestStatus } from '@/lib/billing/upgrade-request-service';
import { enqueueEmailBestEffort } from '@/lib/billing/email-outbox';
import {
  buildMailtoUrl,
  buildWhatsappUrl,
  whatsappPrefill,
} from '@/lib/billing/upgrade-requests';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({
      event: 'admin_access_denied',
      context: { route: '/api/admin/upgrade-requests/[id]' },
    });
    return privateNoStore(apiError('FORBIDDEN', 'Administrator access is required.', { request }));
  }

  const { id } = await context.params;

  return handleRoute(
    async () => {
      const item = await prisma.upgradeRequest.findUnique({
        where: { id },
        select: {
          id: true,
          requestedPlan: true,
          currentPlanSnapshot: true,
          currentStatusSnapshot: true,
          contactMethod: true,
          contactEmail: true,
          whatsappNumber: true,
          message: true,
          status: true,
          adminNote: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              createdAt: true,
              emailVerified: true,
              lastActiveDate: true,
              role: true,
            },
          },
          resolvedByAdmin: { select: { id: true, email: true } },
        },
      });

      if (!item) return apiError('NOT_FOUND', 'Upgrade request not found.', { request });

      const [effective, jobCount] = await Promise.all([
        getEffectiveSubscription(item.user.id),
        prisma.jobLead.count({ where: { userId: item.user.id, deletedAt: null } }),
      ]);

      return privateNoStore(
        jsonOk(
          {
            request: {
              ...item,
              whatsappUrl: buildWhatsappUrl(item.whatsappNumber, whatsappPrefill(item.user.name, item.requestedPlan)),
              mailtoUrl: buildMailtoUrl(
                item.contactEmail,
                `Your teChia Jobs ${item.requestedPlan} upgrade request`,
              ),
            },
            user: { ...item.user, effective, jobCount },
          },
          request,
        ),
      );
    },
    { event: 'admin_upgrade_request_detail_failed', route: '/api/admin/upgrade-requests/[id]' },
  );
}

const patchSchema = z
  .object({
    action: z.enum(['mark_contacted', 'approve', 'reject', 'cancel', 'add_note']),
    adminNote: z.string().trim().max(1000).nullish(),
    /**
     * For approve: also activate the plan in the same transaction.
     * Plan activation and request resolution must never be half-applied.
     */
    activatePlan: z.boolean().optional(),
    planCode: z.enum(['FREE', 'PRO', 'PREMIUM']).optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).nullish(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.action !== 'approve' || v.activatePlan !== true || Boolean(v.planCode), {
    message: 'A plan is required when activating a plan on approval.',
    path: ['planCode'],
  });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({
      event: 'admin_access_denied',
      context: { route: '/api/admin/upgrade-requests/[id]' },
    });
    return privateNoStore(apiError('FORBIDDEN', 'Administrator access is required.', { request }));
  }

  const rate = applyRateLimit(`admin-request:${admin.id}`, 120, 60_000);
  if (!rate.ok) {
    return apiError('RATE_LIMITED', 'Too many requests at once. Please wait a moment.', { request });
  }

  const { id } = await context.params;

  return handleRoute(
    async () => {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return apiError('BAD_REQUEST', 'Invalid request body.', { request });
      }

      const parsed = patchSchema.safeParse(raw);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Please check the values and try again.', {
          request,
          meta: { details: parsed.error.issues.map((i) => i.message).slice(0, 5) },
        });
      }

      const body = parsed.data;

      // Internal note only — no status change.
      if (body.action === 'add_note') {
        await prisma.upgradeRequest.update({
          where: { id },
          data: { adminNote: body.adminNote ?? null },
        });
        return privateNoStore(jsonOk({ ok: true }, request));
      }

      const statusMap = {
        mark_contacted: 'CONTACTED',
        approve: 'APPROVED',
        reject: 'REJECTED',
        cancel: 'CANCELLED',
      } as const;
      const targetStatus = statusMap[body.action];

      // Approve + activate in ONE transaction so the plan change and the
      // request resolution commit or roll back together.
      if (body.action === 'approve' && body.activatePlan) {
        const { adminChangePlan, PlanChangeError } = await import('@/lib/billing/admin-plan-service');

        const existing = await prisma.upgradeRequest.findUnique({
          where: { id },
          select: { id: true, userId: true, requestedPlan: true },
        });
        if (!existing) return apiError('NOT_FOUND', 'Upgrade request not found.', { request });

        try {
          const result = await adminChangePlan({
            userId: existing.userId,
            planCode: body.planCode ?? existing.requestedPlan,
            ...(body.startsAt ? { startsAt: new Date(body.startsAt) } : {}),
            endsAt: body.endsAt ? new Date(body.endsAt) : null,
            reason: body.reason || `Approved upgrade request to ${body.planCode ?? existing.requestedPlan}`,
            adminNote: body.adminNote ?? null,
            adminId: admin.id,
            // Resolves the request inside the same transaction.
            resolveUpgradeRequestId: id,
          });

          return privateNoStore(jsonOk({ ok: true, effective: result.effective }, request));
        } catch (error) {
          if (error instanceof PlanChangeError) {
            const code =
              error.code === 'FORBIDDEN'
                ? 'FORBIDDEN'
                : error.status === 404
                  ? 'NOT_FOUND'
                  : 'CONFLICT';
            return apiError(code, error.message, { request, status: error.status });
          }
          throw error;
        }
      }

      try {
        await adminUpdateUpgradeRequestStatus({
          requestId: id,
          to: targetStatus,
          adminId: admin.id,
          adminNote: body.adminNote ?? null,
        });
      } catch (error) {
        const err = error as Error & { code?: string; status?: number };
        if (err.code === 'INVALID_TRANSITION') {
          return apiError('INVALID_TRANSITION', err.message, { request, status: 409 });
        }
        if (err.code === 'REQUEST_NOT_FOUND') {
          return apiError('NOT_FOUND', 'Upgrade request not found.', { request });
        }
        throw error;
      }

      // Notify the user that their request was resolved (best effort, after
      // the transaction has committed).
      const item = await prisma.upgradeRequest.findUnique({
        where: { id },
        select: { user: { select: { email: true } }, requestedPlan: true, status: true },
      });
      if (item) {
        await enqueueEmailBestEffort({
          type: 'upgrade_request_resolved',
          recipient: item.user.email,
          payload: { requestedPlan: item.requestedPlan, status: targetStatus },
          idempotencyKey: `request-resolved:${id}:${targetStatus}`,
        });
      }

      await logImportantInfo({
        event: `upgrade_request_${targetStatus.toLowerCase()}`,
        context: { requestId: id, adminId: admin.id },
      });

      return privateNoStore(jsonOk({ ok: true, status: targetStatus }, request));
    },
    { event: 'admin_upgrade_request_patch_failed', route: '/api/admin/upgrade-requests/[id]' },
  );
}