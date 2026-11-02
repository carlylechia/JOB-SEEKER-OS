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
import { deleteStoredAsset } from '@/lib/durable-upload';
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
 * Admin-only, destructive user deletion. Safety properties:
 *   - actor must be an ADMIN
 *   - rate limited per admin
 *   - never allows self-deletion
 *   - never allows deleting the last remaining admin
 *   - user-owned relations cascade in the DB transaction
 *   - stored resume/avatar blobs belonging to the user are removed best effort
 *   - every deletion is audit-logged server-side
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
        const target = await prisma.user.findUnique({
          where: { id },
          select: {
            id: true,
            email: true,
            role: true,
            profile: { select: { resumeUrl: true, profilePictureUrl: true } },
            resumeDocuments: { select: { url: true } },
          },
        });

        if (!target) return apiError('NOT_FOUND', 'User not found.', { request });

        if (target.id === admin.id) {
          return apiError('CONFLICT', 'You cannot delete your own administrator account.', { request });
        }

        if (target.role === 'ADMIN') {
          const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
          if (adminCount <= 1) {
            return apiError('CONFLICT', 'Cannot delete the last administrator account.', { request });
          }
        }

        const deleted = await prisma.$transaction(async (tx) => {
          const current = await tx.user.findUnique({
            where: { id },
            select: { id: true, role: true },
          });
          if (!current) throw new AdminUserDeleteError('NOT_FOUND', 'User not found.');
          if (current.id === admin.id) {
            throw new AdminUserDeleteError('CONFLICT', 'You cannot delete your own administrator account.');
          }
          if (current.role === 'ADMIN') {
            const adminCount = await tx.user.count({ where: { role: 'ADMIN' } });
            if (adminCount <= 1) {
              throw new AdminUserDeleteError('CONFLICT', 'Cannot delete the last administrator account.');
            }
          }
          await tx.user.delete({ where: { id } });
          return true;
        });

        // Best-effort storage cleanup; never fail the response if a blob is gone.
        const deletes: Array<Promise<void>> = [];
        if (target.profile?.resumeUrl) {
          deletes.push(deleteStoredAsset(target.profile.resumeUrl, { kind: 'resume', userId: id }));
        }
        if (target.profile?.profilePictureUrl) {
          deletes.push(deleteStoredAsset(target.profile.profilePictureUrl, { kind: 'avatar', userId: id }));
        }
        for (const doc of target.resumeDocuments ?? []) {
          deletes.push(deleteStoredAsset(doc.url, { kind: 'resume', userId: id }));
        }
        await Promise.allSettled(deletes);

        await logImportantInfo({
          event: 'admin_user_deleted',
          userId: admin.id,
          context: { targetUserId: id, targetEmail: target.email, targetRole: target.role },
        });

        if (!deleted) return apiError('INTERNAL_ERROR', 'Something went wrong. Please try again.', { request });

        return privateNoStore(jsonOk({ ok: true, id }, request));
      } catch (error) {
        if (error instanceof AdminUserDeleteError) {
          const code = error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT';
          return apiError(code, error.message, { request });
        }
        throw error;
      }
    },
    { event: 'admin_user_delete_failed', route: '/api/admin/users/[id]' },
  );
}
