/** Generate a private, review-only one-page proposal from an owned resume. */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { requireEntitlement } from '@/lib/billing/subscriptions';
import { RESUME_BUILDER_FEATURE } from '@/lib/resume-builder/entitlements';
import { onePagePreviewRequestSchema } from '@/lib/resume-builder/one-page';
import { prepareOnePageProposal } from '@/lib/resume-builder/one-page-service';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { logImportantInfo } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/one-page';
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
    if (!rate.ok) return apiError('RATE_LIMITED', 'Too many one-page previews. Please wait a moment.', { request });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError('BAD_REQUEST', 'That request was not valid.', { request });
    }
    const parsed = onePagePreviewRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_FAILED', 'Some one-page review settings were not valid.', { request });
    }

    try {
      await requireEntitlement(userId, RESUME_BUILDER_FEATURE);
      const result = await prepareOnePageProposal({ userId, resumeId: id, input: parsed.data, route: ROUTE });
      await logImportantInfo({
        event: 'one_page_resume_previewed',
        userId,
        route: ROUTE,
        jobId: result.targetJobId ?? undefined,
        context: {
          sourceResumeId: result.source.id,
          pageCount: result.proposal.pageCount,
          attempts: result.proposal.measurementAttempts,
          canSave: result.proposal.canSave,
        },
      });
      return privateNoStore(jsonOk({
        source: { id: result.source.id, name: result.source.name, revision: result.source.revision },
        targetJob: result.targetJob ? {
          id: result.targetJob.id,
          title: result.targetJob.title,
          company: result.targetJob.company,
          hasDescription: Boolean(result.targetJob.jobDescription?.trim()),
        } : null,
        proposal: result.proposal,
      }, request));
    } catch (error) {
      return resumeBuilderErrorResponse(error, request);
    }
  }, { event: 'one_page_resume_preview_failed', route: ROUTE });
}
