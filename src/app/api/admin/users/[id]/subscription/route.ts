/**
 * PATCH /api/admin/users/[id]/subscription
 *
 * The admin plan-change endpoint.
 *
 * SECURITY:
 *   - admin-only, re-verified inside the service transaction
 *   - the target user comes from the URL; the ACTOR comes from the session
 *   - a manual change REQUIRES a reason (recorded in the audit trail)
 *   - `status` can never be set by an ordinary user — this route is admin-only
 *   - the mutation is transactional; a failure never reports success
 *   - rate limited to stop accidental double-submits and abuse
 */

import { z } from 'zod';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { getCurrentAdmin } from '@/lib/authz';
import { applyRateLimit } from '@/lib/rate-limit';
import { logImportantInfo } from '@/lib/observability';
import {
  adminChangePlan,
  adminExtendTrial,
  adminSuspendPlan,
  PlanChangeError,
} from '@/lib/billing/admin-plan-service';

export const dynamic = 'force-dynamic';

/** ISO datetime or null. Rejects free-text like "next Friday". */
const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/i))
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Invalid date.' });

const patchSchema = z
  .object({
    action: z.enum(['set_plan', 'extend_trial', 'suspend']).default('set_plan'),
    planCode: z.enum(['FREE', 'PRO', 'PREMIUM']).optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.nullish(),
    reason: z.string().trim().min(3, 'A reason is required.').max(500),
    adminNote: z.string().trim().max(1000).nullish(),
    resolveUpgradeRequestId: z.string().min(1).max(64).optional(),
    /** For action=extend_trial */
    newTrialEndsAt: isoDate.optional(),
  })
  .strict()
  .refine((v) => v.action !== 'set_plan' || Boolean(v.planCode), {
    message: 'A plan is required.',
    path: ['planCode'],
  })
  .refine((v) => v.action !== 'extend_trial' || Boolean(v.newTrialEndsAt), {
    message: 'A new trial end date is required.',
    path: ['newTrialEndsAt'],
  });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({
      event: 'admin_access_denied',
      context: { route: '/api/admin/users/[id]/subscription' },
    });
    return privateNoStore(apiError('FORBIDDEN', 'Administrator access is required.', { request }));
  }

  // Generous enough for normal work, low enough to stop runaway scripts.
  const rate = applyRateLimit(`admin-plan:${admin.id}`, 60, 60_000);
  if (!rate.ok) {
    return apiError('RATE_LIMITED', 'Too many plan changes at once. Please wait a moment.', { request });
  }

  const { id: targetUserId } = await context.params;

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

      try {
        if (body.action === 'suspend') {
          const result = await adminSuspendPlan({
            userId: targetUserId,
            reason: body.reason,
            adminId: admin.id,
          });
          return privateNoStore(jsonOk({ ok: true, effective: result.effective }, request));
        }

        if (body.action === 'extend_trial') {
          const result = await adminExtendTrial({
            userId: targetUserId,
            newTrialEndsAt: body.newTrialEndsAt!,
            reason: body.reason,
            adminId: admin.id,
          });
          return privateNoStore(jsonOk({ ok: true, effective: result.effective }, request));
        }

        const result = await adminChangePlan({
          // Target from the URL, actor from the session. A client cannot
          // impersonate the acting admin.
          userId: targetUserId,
          planCode: body.planCode!,
          startsAt: body.startsAt,
          endsAt: body.endsAt ?? null,
          reason: body.reason,
          adminNote: body.adminNote ?? null,
          adminId: admin.id,
          resolveUpgradeRequestId: body.resolveUpgradeRequestId,
        });

        return privateNoStore(jsonOk({ ok: true, effective: result.effective }, request));
      } catch (error) {
        if (error instanceof PlanChangeError) {
          return apiError(
            error.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'CONFLICT',
            error.message,
            { request, status: error.status, meta: { code: error.code } },
          );
        }
        throw error;
      }
    },
    { event: 'admin_subscription_patch_failed', route: '/api/admin/users/[id]/subscription' },
  );
}