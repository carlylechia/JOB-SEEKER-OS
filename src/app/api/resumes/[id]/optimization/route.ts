/**
 * Job-specific optimisation API.
 *
 *   GET  /api/resumes/[id]/optimization  -> the caller's entitlements, the
 *                                           target job, and any stored proposal
 *   POST /api/resumes/[id]/optimization  -> run (or reuse) a proposal
 *
 * The target job comes from the resume's own `targetJobId`, never from the
 * request body. A caller who posts `{ jobId: "…someone-else's-job" }` fails
 * validation, and one who posts nothing is optimised for the job the resume is
 * already aimed at. There is no code path by which a private job id arrives from
 * a client and is used without an ownership-scoped lookup.
 *
 * The resume id is resolved with `{ id, userId }`, so another user's resume is a
 * 404 identical in shape to one that does not exist.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { getOptimizationModel } from '@/lib/resume-builder/optimization/ai-client';
import { AI_PRIVACY_NOTICE } from '@/lib/resume-builder/optimization/prompt';
import {
  buildOptimizationInputs,
  getOptimizationForResume,
  runOptimization,
  type RunOptimizationResult,
} from '@/lib/resume-builder/optimization/service';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { RESUME_OPTIMIZATION_FEATURE } from '@/lib/resume-builder/entitlements';
import { serialiseOptimization } from '@/lib/resume-builder/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/optimization';

/**
 * Burst limit. The monthly AI credit is the real spend control; this exists to
 * stop a stuck retry loop from hammering the provider in the meantime.
 */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;
      const { id } = await params;
      const url = new URL(request.url);
      const requested = url.searchParams.get('optimizationId');

      const entitlements = await getEntitlements(userId);
      const access = {
        canOptimize: entitlements.features[RESUME_OPTIMIZATION_FEATURE],
        plan: entitlements.plan,
        isAdmin: entitlements.isAdmin,
        isTrialing: entitlements.isTrialing,
        aiCreditsRemaining: entitlements.limits.aiCredits,
      };

      // Resolving the inputs is also the ownership check: a resume belonging to
      // someone else raises the same error as one that does not exist.
      let inputs;
      try {
        inputs = await buildOptimizationInputs({ userId, resumeId: id });
      } catch (error) {
        const response = resumeBuilderErrorResponse(error, request);
        response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
        return response;
      }

      // An explicitly requested id must belong to THIS resume and this user.
      let stored = null;
      try {
        stored = await getOptimizationForResume({
          userId,
          resumeId: id,
          optimizationId: requested ?? undefined,
        });
      } catch {
        stored = null;
      }

      return privateNoStore(
        jsonOk(
          {
            available: true,
            resume: { id: inputs.resume.id, name: inputs.resume.name, revision: inputs.resume.revision },
            job: {
              id: inputs.job.id,
              title: inputs.job.title,
              company: inputs.job.company,
              hasDescription: inputs.hadJobDescription,
              fitScore: inputs.fitScore,
              fitTier: inputs.fitTier,
              blockedBy: inputs.blockedBy,
            },
            readiness: {
              hasJobDescription: inputs.hadJobDescription,
              hasConfirmedProfile: inputs.hadConfirmedProfile,
              resumeCharacters: inputs.resumeText.length,
              thinInputs: inputs.thinInputs,
            },
            optimization: stored ? serialiseOptimization(stored) : null,
            access,
            privacyNotice: AI_PRIVACY_NOTICE,
            model: getOptimizationModel(),
          },
          request,
        ),
      );
    },
    { event: 'resume_optimization_state_failed', route: ROUTE },
  );
}

/**
 * Strict: an unexpected field is an error, not something to ignore. A payload
 * carrying `userId`, `jobId`, `plan` or `content` must not validate — in
 * particular there is no way to name a different target job from here.
 */
const requestSchema = z
  .object({
    /** Re-run even when a completed proposal exists for these exact inputs. */
    force: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;
      const { id } = await params;

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many optimisation runs. Please wait a moment.', {
          request,
        });
      }

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        // An empty body is legitimate: optimise this resume for the job it is
        // already aimed at.
      }

      const parsed = requestSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      let result: RunOptimizationResult;
      try {
        result = await runOptimization({
          userId,
          resumeId: id,
          force: parsed.data.force === true,
          route: ROUTE,
        });
      } catch (error) {
        // Domain failures are responses, not crashes. Anything genuinely
        // unexpected is re-thrown and handled by handleRoute's logged 500.
        return resumeBuilderErrorResponse(error, request);
      }

      if (result.outcome === 'FAILED') {
        return apiError('AI_UNAVAILABLE', result.message, {
          request,
          meta: { code: result.code, retryable: result.retryable },
        });
      }

      return privateNoStore(
        jsonOk(
          {
            outcome: result.outcome,
            optimizationId: result.optimization.id,
            resumeId: result.optimization.resumeId,
            jobId: result.optimization.jobId,
            status: result.optimization.status,
            model: result.optimization.model,
            createdAt: result.optimization.createdAt.toISOString(),
            completedAt: result.optimization.completedAt?.toISOString() ?? null,
            isFresh: result.optimization.isFresh,
            /**
             * Returned inline so a run is a single round trip. The proposal has
             * already been verified and bounded server-side, and the response is
             * `private, no-store`.
             */
            data: result.data,
            ...(result.outcome === 'COMPLETED' ? { creditsConsumed: result.creditsConsumed } : {}),
          },
          request,
        ),
      );
    },
    { event: 'resume_optimization_route_failed', route: ROUTE },
  );
}