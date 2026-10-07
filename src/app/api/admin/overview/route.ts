/**
 * GET /api/admin/overview
 *
 * Real metrics only — no vanity numbers and no full-table scans.
 * Admin-only; every query is an aggregate or a bounded take.
 */

import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { getCurrentAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { getEmailOutboxHealth } from '@/lib/billing/email-outbox';
import { addDays, now } from '@/lib/billing/clock';
import { logImportantInfo } from '@/lib/observability';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({
      event: 'admin_access_denied',
      context: { route: '/api/admin/overview', reason: 'not_admin' },
    });
    // Same response whether unauthenticated or merely not an admin, so this
    // route never reveals that an admin surface exists.
    return privateNoStore(
      apiError('FORBIDDEN', 'Administrator access is required.', { request }),
    );
  }

  return handleRoute(
    async () => {
      const at = now();
      const trialCutoff = addDays(at, 7);

      const [
        totalUsers,
        totalAdmins,
        freeUsers,
        trialUsers,
        paidUsers,
        pendingRequests,
        trialsEndingSoon,
        recentEvents,
        email,
        monetization,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { role: 'ADMIN' } }),
        prisma.subscription.count({ where: { status: 'ACTIVE', plan: { code: 'FREE' } } }),
        prisma.subscription.count({ where: { status: 'TRIALING', trialEndsAt: { gt: at } } }),
        prisma.subscription.count({ where: { status: 'ACTIVE', plan: { code: { in: ['PRO', 'PREMIUM'] } } } }),
        prisma.upgradeRequest.count({ where: { status: { in: ['PENDING', 'CONTACTED'] } } }),
        prisma.subscription.count({
          where: { status: 'TRIALING', trialEndsAt: { gt: at, lte: trialCutoff } },
        }),
        prisma.subscriptionEvent.findMany({
          take: 8,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            previousPlanCode: true,
            newPlanCode: true,
            reason: true,
            createdAt: true,
            user: { select: { id: true, email: true, name: true } },
          },
        }),
        getEmailOutboxHealth(),
        prisma.monetizationConfig.findUnique({
          where: { id: 'global' },
          select: {
            enabledAt: true,
            existingUserTrialStartedAt: true,
            existingUserTrialEndsAt: true,
            initializedAt: true,
          },
        }),
      ]);

      return privateNoStore(
        jsonOk(
          {
            metrics: {
              totalUsers,
              totalAdmins,
              freeUsers,
              trialUsers,
              paidUsers,
              pendingRequests,
              trialsEndingSoon,
            },
            recentActivity: recentEvents,
            email,
            monetization: monetization ?? null,
          },
          request,
        ),
      );
    },
    { event: 'admin_overview_failed', route: '/api/admin/overview' },
  );
}