/**
 * Jobs this user may target a resume to.
 *
 *   GET /api/resumes/eligible-jobs
 *
 * Scoped to the caller's own, non-deleted `JobLead` rows. It deliberately does
 * NOT read the public job catalogue: a public job must be imported into the
 * user's workspace first, which is the existing import policy rather than one
 * this release relaxes. Offering an un-importable job here would produce a
 * selection that fails on the next step.
 *
 * Cost: none. No provider call, no credit.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { listTargetableJobs } from '@/lib/resume-builder/documents';
import { RESUME_OPTIMIZATION_FEATURE } from '@/lib/resume-builder/entitlements';
import { serialiseTargetableJob } from '@/lib/resume-builder/wire';
import { getAiCreditsPayload } from '@/lib/billing/ai-credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/eligible-jobs';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 120, 60_000);
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const [jobs, entitlements] = await Promise.all([
        listTargetableJobs(userId),
        getEntitlements(userId),
      ]);

      // The measured balance, not the plan's ceiling.
      const aiCredits = await getAiCreditsPayload(userId, entitlements.limits.aiCredits);

      return privateNoStore(
        jsonOk(
          {
            jobs: jobs.map(serialiseTargetableJob),
            access: {
              canOptimize: entitlements.features[RESUME_OPTIMIZATION_FEATURE],
              plan: entitlements.plan,
              isAdmin: entitlements.isAdmin,
              isTrialing: entitlements.isTrialing,
              aiCredits,
            },
          },
          request,
        ),
      );
    },
    { event: 'eligible_jobs_failed', route: ROUTE },
  );
}