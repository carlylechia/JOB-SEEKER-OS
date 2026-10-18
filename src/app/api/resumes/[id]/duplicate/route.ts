/**
 * Duplicate a resume.
 *
 *   POST /api/resumes/[id]/duplicate
 *
 * A dedicated endpoint rather than `POST /api/resumes` with a `sourceResumeId`
 * so the editor's "Duplicate" button acts on the resume the user is looking at.
 * The id still comes from the URL and is resolved with `{ id, userId }`, so it
 * cannot be swapped for someone else's.
 *
 * The copy is independent from the moment it is created: the content is
 * deep-copied, entry ids are fresh, and the two documents never share state.
 * Editing or deleting either leaves the other untouched.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getEntitlements, requireEntitlement } from '@/lib/billing/subscriptions';
import { duplicateResume } from '@/lib/resume-builder/documents';
import { RESUME_BUILDER_FEATURE } from '@/lib/resume-builder/entitlements';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { serialiseResume } from '@/lib/resume-builder/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/duplicate';
type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;
      const { id } = await params;

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 20, 60_000);
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      try {
        await requireEntitlement(userId, RESUME_BUILDER_FEATURE);
        const entitlements = await getEntitlements(userId);
        const created = await duplicateResume({
          userId,
          resumeId: id,
          limit: entitlements.limits.resumes,
        });
        return privateNoStore(jsonOk({ resume: serialiseResume(created) }, request, { status: 201 }));
      } catch (error) {
        return resumeBuilderErrorResponse(error, request);
      }
    },
    { event: 'resume_duplicate_failed', route: ROUTE },
  );
}