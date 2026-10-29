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
import {
  getStoredMaterialContent,
  serialiseMaterialDetail,
} from '@/lib/application-materials/wire';

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
        select: {
          id: true,
          type: true,
          jobId: true,
          resumeId: true,
          revision: true,
          content: true,
          status: true,
          generationMeta: true,
        },
      });
      if (!existing) {
        return apiError('NOT_FOUND', 'Material not found.', { request });
      }

      // The draft the user sees is the draft the model must improve. Legacy
      // rows stored their verified text only in generation metadata, so read
      // through the same accessor the editor uses.
      const sourceDraft = getStoredMaterialContent(existing);
      if (!sourceDraft.trim()) {
        return apiError(
          'VALIDATION_FAILED',
          'This draft has no text to revise yet. Generate or write it first, then ask for a revision.',
          { request },
        );
      }

      // Preserve the choices the draft was written with unless the caller
      // explicitly changes them. A revision is an edit of this draft, not a
      // silent reset to the default tone and length.
      const storedMeta = existing.generationMeta as
        | { meta?: { tone?: unknown; length?: unknown } }
        | null
        | undefined;
      const storedTone =
        typeof storedMeta?.meta?.tone === 'string' ? storedMeta.meta.tone : undefined;
      const storedLength =
        typeof storedMeta?.meta?.length === 'string' ? storedMeta.meta.length : undefined;

      let result;
      try {
        result = await runGeneration({
          userId,
          type: existing.type,
          jobId: existing.jobId ?? null,
          resumeId: existing.resumeId ?? null,
          origin: 'AI_REVISED',
          supersedesId: id,
          force: true,
          route: ROUTE,
          provider: resolveApplicationMaterialAiProvider(),
          tone: data.tone ?? storedTone ?? 'PROFESSIONAL',
          length: data.length ?? storedLength ?? 'STANDARD',
          instructions: data.instructions,
          conversation: null,
          recipientName: null,
          sourceDraft,
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

      // The service already persisted the canonical title, verified content and
      // subject, and incremented the revision. Read the row back rather than
      // patching it here, so the response is exactly what a later GET returns.
      const updated = await prisma.applicationMaterial.findFirst({
        where: { id: result.summary.id, userId },
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
      if (!updated) {
        // The row was created and completed in this request, so this is not a
        // user state: it means the database changed underneath us.
        throw new Error('Revision row disappeared after generation.');
      }

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
