/** Refine a candidate-authored response to one information-gap question. */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { refineInformationGapAnswer } from '@/lib/resume-builder/optimization/service';
import { refineInformationGapAnswerSchema } from '@/lib/resume-builder/requests';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/optimization/answer';
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
    const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 10, 60_000);
    if (!rate.ok) {
      return apiError('RATE_LIMITED', 'Too many answer rewrites. Please wait a moment.', { request });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError('BAD_REQUEST', 'That request was not valid.', { request });
    }
    const parsed = refineInformationGapAnswerSchema.safeParse(body);
    if (!parsed.success) return apiError('VALIDATION_FAILED', 'Enter an answer before asking for a rewrite.', { request });

    try {
      const result = await refineInformationGapAnswer({
        userId,
        resumeId: id,
        ...parsed.data,
        route: ROUTE,
      });
      return privateNoStore(jsonOk(result, request));
    } catch (error) {
      return resumeBuilderErrorResponse(error, request);
    }
  }, { event: 'resume_information_gap_answer_failed', route: ROUTE });
}
