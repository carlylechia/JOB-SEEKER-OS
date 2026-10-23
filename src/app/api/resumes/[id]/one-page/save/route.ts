/** Save a reviewed one-page proposal as a separate structured resume. */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getEntitlements, requireEntitlement } from '@/lib/billing/subscriptions';
import { createOnePageResume, ResumeRevisionConflictError } from '@/lib/resume-builder/documents';
import { RESUME_BUILDER_FEATURE } from '@/lib/resume-builder/entitlements';
import { onePageSaveRequestSchema } from '@/lib/resume-builder/one-page';
import { OnePageDoesNotFitError } from '@/lib/resume-builder/one-page-errors';
import { prepareOnePageProposal } from '@/lib/resume-builder/one-page-service';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { serialiseResumeDetail } from '@/lib/resume-builder/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/one-page/save';
type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const session = await auth();
    if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

    const userId = session.user.id;
    const { id } = await params;
    const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 8, 60_000);
    if (!rate.ok) return apiError('RATE_LIMITED', 'Too many one-page saves. Please wait a moment.', { request });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError('BAD_REQUEST', 'That request was not valid.', { request });
    }
    const parsed = onePageSaveRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_FAILED', 'Some one-page review settings were not valid.', { request });
    }

    try {
      await requireEntitlement(userId, RESUME_BUILDER_FEATURE);
      const result = await prepareOnePageProposal({ userId, resumeId: id, input: parsed.data, route: ROUTE });
      if (result.source.revision !== parsed.data.expectedRevision) {
        throw new ResumeRevisionConflictError(result.source.revision);
      }
      if (!result.proposal.canSave || result.proposal.pageCount !== 1) {
        throw new OnePageDoesNotFitError(result.proposal.pageCount);
      }

      const entitlements = await getEntitlements(userId);
      const resume = await createOnePageResume({
        userId,
        sourceResumeId: result.source.id,
        expectedRevision: parsed.data.expectedRevision,
        name: parsed.data.name,
        content: result.proposal.content,
        targetJobId: result.targetJobId,
        templateKey: result.proposal.templateKey,
        pageSize: result.proposal.pageSize,
        limit: entitlements.limits.resumes,
      });

      return privateNoStore(jsonOk({
        resume: serialiseResumeDetail(resume),
        layout: result.proposal.layout,
        pageCount: result.proposal.pageCount,
      }, request, { status: 201 }));
    } catch (error) {
      return resumeBuilderErrorResponse(error, request);
    }
  }, { event: 'one_page_resume_save_failed', route: ROUTE });
}
