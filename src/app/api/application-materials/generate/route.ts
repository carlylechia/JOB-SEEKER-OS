/**
 * AI application materials — generation.
 *
 *   POST /api/application-materials/generate
 *
 * Runs (or reuses) a generation for one material type. Every check happens
 * before any provider call:
 *
 *   authenticate → entitlement → load job/profile/resume → fingerprint → reuse
 *   check → claim row → usage → provider → verify → persist.
 *
 * No userId, plan or role parameter exists anywhere in this file, so there is
 * nothing for a caller to swap. The job is resolved with { id, userId }, so a
 * job belonging to someone else is a 404 identical to one that does not exist.
 *
 * Nothing is ever sent externally: this route generates a draft and stores it.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { getEntitlements } from '@/lib/billing/subscriptions';
import {
  runGeneration,
  APPLICATION_MATERIAL_FEATURE,
  type RunGenerationOptions,
} from '@/lib/application-materials/service';
import { resolveApplicationMaterialAiProvider } from '@/lib/application-materials/ai-client';
import { applicationMaterialErrorResponse } from '@/lib/application-materials/route-errors';
import { generateMaterialRequestSchema } from '@/lib/application-materials/requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/application-materials/generate';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const userId = session.user.id;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        RATE_LIMIT,
        RATE_WINDOW_MS,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many drafts. Please wait a moment.', { request });
      }

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const parsed = generateMaterialRequestSchema.safeParse(body);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', {
          request,
          meta: { fields: validationFields(parsed.error) },
        });
      }

      const data = parsed.data;

      let result;
      try {
        result = await runGeneration({
          userId,
          type: data.type,
          jobId: data.jobId ?? null,
          resumeId: data.resumeId ?? null,
          title: data.instructions?.slice(0, 60) || `${data.type} draft`,
          origin: 'AI_GENERATED',
          supersedesId: null,
          force: data.force === true,
          route: ROUTE,
          provider: resolveApplicationMaterialAiProvider(),
        });
      } catch (error) {
        return applicationMaterialErrorResponse(error, request);
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
            materialId: result.summary.id,
            jobId: result.summary.jobId,
            status: result.summary.status,
            generationStatus: result.summary.generationStatus,
            model: result.summary.model,
            creditsConsumed:
              result.outcome === 'COMPLETED' ? result.creditsConsumed : null,
            result: result.material,
          },
          request,
        ),
      );
    },
    { event: 'application_material_generate_route_failed', route: ROUTE },
  );
}

function validationFields(error: z.ZodError) {
  return error.issues.slice(0, 6).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
