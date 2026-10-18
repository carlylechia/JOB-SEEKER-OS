/**
 * AI application materials — revision.
 *
 *   POST /api/application-materials/[id]/revise
 *
 * Produces a revised draft from an existing saved material. The new draft is a
 * NEW row chained through `supersedesId`; the previous draft is left intact
 * until the user explicitly replaces it. A revision request is never treated as
 * permission to invent new personal facts — the same verification pass applies
 * as to a first generation.
 *
 * Consumes one AI credit like any fresh generation.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { runGeneration, APPLICATION_MATERIAL_FEATURE } from '@/lib/application-materials/service';
import { resolveApplicationMaterialAiProvider } from '@/lib/application-materials/ai-client';
import { applicationMaterialErrorResponse } from '@/lib/application-materials/route-errors';
import { reviseMaterialRequestSchema } from '@/lib/application-materials/requests';
import { serialiseMaterialDetail } from '@/lib/application-materials/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/application-materials/[id]/revise';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const userId = session.user.id;
      const { id } = await params;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        RATE_LIMIT,
        RATE_WINDOW_MS,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many revisions. Please wait a moment.', { request });
      }

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const parsed = reviseMaterialRequestSchema.safeParse(body);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', {
          request,
          meta: { fields: validationFields(parsed.error) },
        });
      }

      const data = parsed.data;

      // The material being revised must belong to the caller.
      const existing = await prisma.applicationMaterial.findFirst({
        where: { id, userId },
        select: { id: true, type: true, jobId: true, resumeId: true, revision: true },
      });
      if (!existing) {
        return apiError('NOT_FOUND', 'Material not found.', { request });
      }

      let result;
      try {
        result = await runGeneration({
          userId,
          type: existing.type,
          jobId: existing.jobId ?? null,
          resumeId: existing.resumeId ?? null,
          title: `${existing.type} (revision)`,
          origin: 'AI_REVISED',
          supersedesId: id,
          force: true,
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

      // Patch the freshly-created row with the revision's title and content.
      // The row was created by runGeneration with a placeholder title; the real
      // content lives in result.material.content.
      const updated = await prisma.applicationMaterial.update({
        where: { id: result.summary.id },
        data: {
          title: data.instructions.slice(0, 60),
          content: result.material.content,
          subject: result.material.subject,
        },
        select: {
          userId: true,
          id: true,
          type: true,
          title: true,
          subject: true,
          content: true,
          status: true,
          origin: true,
          generationStatus: true,
          jobId: true,
          resumeId: true,
          templateId: true,
          revision: true,
          supersedesId: true,
          jobStage: true,
          appliedAt: true,
          nextFollowUpAt: true,
          schemaVersion: true,
          promptVersion: true,
          inputFingerprint: true,
          generationMeta: true,
          errorCode: true,
          provider: true,
          model: true,
          creditsConsumed: true,
          thinInputs: true,
          editVersion: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return privateNoStore(
        jsonOk(
          {
            outcome: result.outcome,
            materialId: result.summary.id,
            supersedesId: id,
            previousRevision: existing.revision,
            newRevision: updated.revision,
            creditsConsumed:
              result.outcome === 'COMPLETED' ? result.creditsConsumed : null,
            result: serialiseMaterialDetail(updated),
          },
          request,
        ),
      );
    },
    { event: 'application_material_revise_route_failed', route: ROUTE },
  );
}

function validationFields(error: z.ZodError) {
  return error.issues.slice(0, 6).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
