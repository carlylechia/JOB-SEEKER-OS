/**
 * GET /api/billing/summary
 *
 * The authenticated user's own billing state: plan, status, trial window,
 * upgrade request status.
 *
 * SECURITY: returns ONLY the caller's own data. Admin notes, audit history and
 * other users' information are never included. Response is private/no-store so
 * one user's billing state can never be served from a shared cache.
 */

import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { getCurrentUser } from '@/lib/authz';
import { getUserBillingSummary } from '@/lib/billing/monetization';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return privateNoStore(apiError('UNAUTHENTICATED', 'Please sign in to view your plan.', { request }));
  }

  return handleRoute(
    async () => {
      const summary = await getUserBillingSummary(user.id);
      // The summary is already scoped to `user.id` from the session — there is
      // no userId parameter anywhere in this route.
      return privateNoStore(jsonOk(summary, request));
    },
    { event: 'billing_summary_failed', route: '/api/billing/summary', userId: user.id },
  );
}