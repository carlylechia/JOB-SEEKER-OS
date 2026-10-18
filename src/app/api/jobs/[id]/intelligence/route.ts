/**
 * AI Job Intelligence API.
 *
 *   GET  /api/jobs/[id]/intelligence  -> the caller's entitlements, their
 *                                       deterministic score, their profile
 *                                       readiness, and any existing analysis
 *   POST /api/jobs/[id]/intelligence  -> run (or reuse) an analysis
 *
 * Every response is scoped by the session. There is no `userId` parameter
 * anywhere in this file, so there is nothing for a caller to swap — and the
 * job id is resolved with `{ id, userId }`, so another user's lead is a 404
 * rather than a 403.
 *
 * The analysis is advisory. This route does not apply to anything, contact an
 * employer, or modify the job. It reads and writes one row the caller owns.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { getJobIntelligenceModel } from '@/lib/job-intelligence/ai-client';
import { AI_PRIVACY_NOTICE } from '@/lib/job-intelligence/prompt';
import {
  getAnalysisContext,
  getAnalysisForJob,
  JOB_INTELLIGENCE_FEATURE,
  runJobAnalysis,
  type RunAnalysisResult,
} from '@/lib/job-intelligence/service';
import { jobIntelligenceErrorResponse } from '@/lib/job-intelligence/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/jobs/[id]/intelligence';

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

      const entitlements = await getEntitlements(userId);

      // Resolving the context is also the ownership check: a job belonging to
      // someone else resolves to null here exactly as it does in the POST path.
      const context = await getAnalysisContext({ userId, jobId: id });

      if (!context) {
        return privateNoStore(
          jsonOk(
            {
              available: false,
              reason: 'JOB_NOT_FOUND',
              access: { canAnalyze: entitlements.features[JOB_INTELLIGENCE_FEATURE], plan: entitlements.plan },
            },
            request,
          ),
        );
      }

      const existing = await getAnalysisForJob({ userId, jobId: id });

      return privateNoStore(
        jsonOk(
          {
            available: true,
            job: {
              id: context.inputs.job.id,
              title: context.inputs.job.title,
              company: context.inputs.job.company,
              hasDescription: context.inputs.hadJobDescription,
            },
            // The application's own numbers, so the UI can show them next to the
            // AI's explanation as two separate things rather than one.
            deterministic: {
              fitScore: context.inputs.fitScore,
              fitTier: context.inputs.fitTier,
              titleMatch: context.inputs.titleMatch,
              blockedBy: context.inputs.blockedBy,
              titleRelationship: context.inputs.titleRelationship,
            },
            profile: {
              completeness: context.profile.completeness,
              confirmed: context.profile.confirmed,
              missingInputs: context.profile.missingInputs,
            },
            analysis: existing ? serialiseAnalysis(existing) : null,
            access: {
              canAnalyze: entitlements.features[JOB_INTELLIGENCE_FEATURE],
              plan: entitlements.plan,
              isAdmin: entitlements.isAdmin,
              isTrialing: entitlements.isTrialing,
              aiCreditsRemaining: entitlements.limits.aiCredits,
            },
            privacyNotice: AI_PRIVACY_NOTICE,
            model: getJobIntelligenceModel(),
          },
          request,
        ),
      );
    },
    { event: 'job_intelligence_state_failed', route: ROUTE },
  );
}

const requestSchema = z
  .object({
    /**
     * Re-run even when a completed analysis exists for these exact inputs.
     * Explicitly charged as a new operation.
     */
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

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        RATE_LIMIT,
        RATE_WINDOW_MS,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many analyses. Please wait a moment.', { request });
      }

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        // An empty body is a legitimate request: analyse this job as it stands.
      }

      // Strict: an unexpected field is an error, not something to ignore. A
      // payload carrying `userId`, `plan` or `score` must not validate.
      const parsed = requestSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      let result: RunAnalysisResult;
      try {
        result = await runJobAnalysis({
          userId,
          jobId: id,
          force: parsed.data.force === true,
          route: ROUTE,
        });
      } catch (error) {
        // Domain failures are responses, not crashes. Anything genuinely
        // unexpected is re-thrown and handled by handleRoute's logged 500.
        return jobIntelligenceErrorResponse(error, request);
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
            analysisId: result.analysis.id,
            jobId: result.analysis.jobId,
            status: result.analysis.status,
            model: result.analysis.model,
            createdAt: result.analysis.createdAt.toISOString(),
            completedAt: result.analysis.completedAt?.toISOString() ?? null,
            isFresh: result.analysis.isFresh,
            /**
             * Returned inline so a run is a single round trip. The analysis is
             * already verified and bounded server-side, and the response is
             * `private, no-store`.
             */
            data: result.data,
            ...(result.outcome === 'COMPLETED' ? { creditsConsumed: result.creditsConsumed } : {}),
          },
          request,
        ),
      );
    },
    { event: 'job_analysis_route_failed', route: ROUTE },
  );
}

/**
 * Shape an analysis for the wire.
 *
 * Dates become ISO strings and nothing else changes. The verification layer has
 * already bounded every field, so this is a serialisation concern only.
 */
function serialiseAnalysis(existing: NonNullable<Awaited<ReturnType<typeof getAnalysisForJob>>>) {
  return {
    id: existing.analysis.id,
    status: existing.analysis.status,
    schemaVersion: existing.analysis.schemaVersion,
    errorCode: existing.analysis.errorCode,
    model: existing.analysis.model,
    createdAt: existing.analysis.createdAt.toISOString(),
    completedAt: existing.analysis.completedAt?.toISOString() ?? null,
    /**
     * False when the job, profile or preferences changed since this ran. The UI
     * shows the old result with a "things have changed" note rather than
     * silently presenting a stale answer as current.
     */
    isFresh: existing.analysis.isFresh,
    data: existing.data,
  };
}