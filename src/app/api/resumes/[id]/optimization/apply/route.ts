/**
 * Apply accepted optimisation suggestions.
 *
 *   POST /api/resumes/[id]/optimization/apply
 *
 * Accepts a SUBSET. Accepting one suggestion does not accept the rest, does not
 * replace the document, and does not touch any other resume. There is no
 * "apply all" shortcut on this endpoint, because the whole product promise of
 * this feature is that the user stays in control of what ends up in the document
 * they send to an employer.
 *
 * Cost: none. No provider call, no AI credit. Accepting suggestions is the user
 * finishing work the model already did.
 *
 * The resume this writes to is the resume the suggestions were generated for.
 * There is no parameter naming a different target, so a stale proposal cannot be
 * landed on another document.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { applyAcceptedOperations } from '@/lib/resume-builder/optimization/service';
import { applyOptimizationRequestSchema } from '@/lib/resume-builder/requests';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { buildResumeLayoutFromRecord } from '@/lib/resume-builder/serve';
import { serialiseLayout, serialiseResumeDetail } from '@/lib/resume-builder/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/optimization/apply';
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

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 30, 60_000);
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return apiError('BAD_REQUEST', 'That request was not valid.', { request });
      }

      const parsed = applyOptimizationRequestSchema.safeParse(body);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      try {
        const result = await applyAcceptedOperations({
          userId,
          resumeId: id,
          optimizationId: parsed.data.optimizationId,
          acceptedOperationIds: parsed.data.acceptedOperationIds,
          editedText: parsed.data.editedText,
          expectedRevision: parsed.data.expectedRevision,
        });

        // The preview comes back with the write so the user sees the result they
        // just approved, in the same geometry as the PDF they will export.
        const layout = await buildResumeLayoutFromRecord(result.resume);

        return privateNoStore(
          jsonOk(
            {
              resume: serialiseResumeDetail(result.resume),
              layout: serialiseLayout(layout),
              appliedCount: result.appliedCount,
              skipped: result.skipped,
            },
            request,
          ),
        );
      } catch (error) {
        return resumeBuilderErrorResponse(error, request);
      }
    },
    { event: 'resume_optimization_apply_failed', route: ROUTE },
  );
}