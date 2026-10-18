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

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({ event: 'admin_access_denied', context: { route: '/api/admin/users/[id]' } });
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

      // Do not reveal whether a given user id exists to a non-admin — the
      // admin check above already guarantees the caller is authorised, but a
      // 404 here still avoids confirming ids to a stale page.
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
        // Count only — never the job contents themselves.
        prisma.jobLead.count({ where: { userId: id, deletedAt: null } }),
      ]);

      return privateNoStore(
        jsonOk({ user, effective, usage, jobCount, requests, events }, request),
      );
    },
    { event: 'admin_user_detail_failed', route: '/api/admin/users/[id]' },
  );
}