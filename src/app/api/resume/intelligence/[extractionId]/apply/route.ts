/**
 * POST /api/resume/intelligence/[extractionId]/apply
 *
 * Writes the reviewed extraction into the caller's career profile.
 *
 * This is not an AI operation and costs no credits, but it is still gated on
 * CAREER_PROFILE_INTELLIGENCE: the structured profile is the paid deliverable,
 * and a user who has downgraded keeps all of their data while losing access to
 * rebuild it.
 *
 * Everything else about the write is already decided for the client by
 * `reviewSubmissionSchema` — most importantly, there is no userId, role or plan
 * field to set. Identity comes from the session.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantInfo } from '@/lib/observability';
import { requireEntitlement } from '@/lib/billing/subscriptions';
import { applyReviewedExtraction, reviewSubmissionSchema } from '@/lib/resume/career-profile';
import { CAREER_PROFILE_FEATURE } from '@/lib/resume/service';
import { resumeErrorResponse } from '@/lib/resume/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resume/intelligence/[extractionId]/apply';

type Context = { params: Promise<{ extractionId: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, context: Context) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      const userId = session.user.id;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        30,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many save requests. Please wait a moment.', {
          request,
        });
      }

      const { extractionId } = await context.params;

      try {
        await requireEntitlement(userId, CAREER_PROFILE_FEATURE);
      } catch (error) {
        await logImportantInfo({
          event: 'career_profile_save_denied',
          userId,
          route: ROUTE,
          context: { feature: CAREER_PROFILE_FEATURE },
        });
        return resumeErrorResponse(error, request);
      }

      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return apiError('BAD_REQUEST', 'That request was not valid.', { request });
      }

      const submission = reviewSubmissionSchema.safeParse(raw);
      if (!submission.success) {
        return apiError('VALIDATION_FAILED', 'Some of that information was not valid.', {
          request,
        });
      }

      try {
        const counts = await applyReviewedExtraction({
          userId,
          extractionId,
          submission: submission.data,
          route: ROUTE,
        });
        return privateNoStore(jsonOk({ ok: true, counts }, request));
      } catch (error) {
        return resumeErrorResponse(error, request);
      }
    },
    { event: 'career_profile_save_failed', route: ROUTE },
  );
}