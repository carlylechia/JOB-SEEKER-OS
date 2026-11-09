/**
 * GET /api/admin/users/[id] — admin view of one user's account + billing
 *
 * LEAST PRIVILEGE: account metadata, plan, usage rollup, request history and
 * subscription audit trail. NOT included: password hashes, reset/verification
 * tokens, resume contents, or private file URLs.
 */

import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { getCurrentAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { getEffectiveSubscription } from '@/lib/billing/subscriptions';
import { getUserUsageBreakdown } from '@/lib/billing/usage';
import { logImportantInfo } from '@/lib/observability';
import { applyRateLimit } from '@/lib/rate-limit';
import { deleteAdminUsers } from '@/lib/admin/user-deletion';
import { AdminUserDeleteError } from '@/lib/admin/user-delete-error';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({
      event: 'admin_access_denied',
      context: { route: '/api/admin/users/[id]' },
    });
    return privateNoStore(apiError('FORBIDDEN', 'Administrator access is required.', { request }));
  }

  const { id } = await context.params;

  return handleRoute(
    async () => {
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          emailVerified: true,
          createdAt: true,
          lastActiveDate: true,
          streakCount: true,
        },
      });

      if (!user) return apiError('NOT_FOUND', 'User not found.', { request });

      const [effective, usage, requests, events, jobCount] = await Promise.all([
        getEffectiveSubscription(id),
        getUserUsageBreakdown(id),
        prisma.upgradeRequest.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            requestedPlan: true,
            status: true,
            contactMethod: true,
            createdAt: true,
            resolvedAt: true,
            adminNote: true,
          },
        }),
        prisma.subscriptionEvent.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            type: true,
            previousPlanCode: true,
            newPlanCode: true,
            previousStatus: true,
            newStatus: true,
            reason: true,
            createdAt: true,
            actorAdmin: { select: { id: true, email: true } },
          },
        }),
        prisma.jobLead.count({ where: { userId: id, deletedAt: null } }),
      ]);

      return privateNoStore(
        jsonOk({ user, effective, usage, jobCount, requests, events }, request),
      );
    },
    { event: 'admin_user_detail_failed', route: '/api/admin/users/[id]' },
  );
}

/**
 * DELETE /api/admin/users/[id]
 *
 * Admin-only, destructive individual user deletion. All authorization, safety
 * rules, relation handling, storage cleanup and audit writes live in the shared
 * `deleteAdminUsers` service so the bulk route cannot drift from this one.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({
      event: 'admin_access_denied',
      context: { route: '/api/admin/users/[id]' },
    });
    return privateNoStore(apiError('FORBIDDEN', 'Administrator access is required.', { request }));
  }

  const rate = applyRateLimit(`admin-user-delete:${admin.id}`, 5, 60_000);
  if (!rate.ok) {
    return privateNoStore(
      apiError('RATE_LIMITED', 'Too many delete requests at once. Please wait a moment.', { request }),
    );
  }

  const { id } = await context.params;

  return handleRoute(
    async () => {
      try {
        const result = await deleteAdminUsers({
          actorId: admin.id,
          userIds: [id],
          mode: 'individual',
        });
        const outcome = result.outcomes[0];

        if (outcome?.status === 'deleted') {
          return privateNoStore(
            jsonOk(
              {
                ok: true,
                id,
                auditEventId: result.auditEventId,
                fileCleanup: result.fileCleanup,
              },
              request,
            ),
          );
        }

        if (outcome?.status === 'skipped') {
          return privateNoStore(
            apiError('CONFLICT', outcome.message ?? 'This account is protected.', {
              request,
              meta: { code: outcome.code, auditEventId: result.auditEventId },
            }),
          );
        }

        if (outcome?.code === 'NOT_FOUND') {
          return privateNoStore(
            apiError('NOT_FOUND', 'User not found.', {
              request,
              meta: { auditEventId: result.auditEventId },
            }),
          );
        }

        return privateNoStore(
          apiError('INTERNAL_ERROR', 'This account could not be deleted.', {
            request,
            meta: { auditEventId: result.auditEventId },
          }),
        );
      } catch (error) {
        if (error instanceof AdminUserDeleteError) {
          if (error.code === 'VALIDATION_FAILED') {
            return apiError('VALIDATION_FAILED', error.message, { request });
          }
          if (error.code === 'FORBIDDEN') {
            return apiError('FORBIDDEN', error.message, { request });
          }
          if (error.code === 'NOT_FOUND') {
            return apiError('NOT_FOUND', error.message, { request });
          }
          if (error.code === 'CONFLICT') {
            return apiError('CONFLICT', error.message, { request });
          }
          return apiError('INTERNAL_ERROR', error.message, {
            request,
            meta: error.code === 'AUDIT_FAILED' ? { auditFailed: true } : undefined,
          });
        }
        throw error;
      }
    },
    { event: 'admin_user_delete_failed', route: '/api/admin/users/[id]' },
  );
}
