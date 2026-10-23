/**
 * AI application materials — read, save, delete.
 *
 *   GET    /api/application-materials/[id]
 *   PATCH  /api/application-materials/[id]
 *   DELETE /api/application-materials/[id]
 *
 * Every operation scopes by the session userId, so a user can never read,
 * update or export another user's private material. The id alone is never
 * trusted as an ownership claim.
 *
 * Saving a draft never calls a provider and never consumes a credit: editing,
 * copying and downloading are free operations by design.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { saveMaterialRequestSchema } from '@/lib/application-materials/requests';
import { serialiseMaterialDetail } from '@/lib/application-materials/wire';
import { applicationMaterialErrorResponse } from '@/lib/application-materials/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/application-materials/[id]';

type Params = { params: Promise<{ id: string }> };

const MATERIAL_FIELDS = {
  id: true,
  userId: true,
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
} satisfies Prisma.ApplicationMaterialSelect;

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
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
        30,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const material = await prisma.applicationMaterial.findFirst({
        where: { id, userId },
        select: MATERIAL_FIELDS,
      });

      if (!material) {
        // Identical for "missing", "deleted" and "belongs to someone else":
        // never confirm that another user's material exists.
        return apiError('NOT_FOUND', 'Material not found.', { request });
      }

      return privateNoStore(
        jsonOk(serialiseMaterialDetail(material), request),
      );
    },
    { event: 'application_material_get_route_failed', route: ROUTE },
  );
}

export async function PATCH(request: Request, { params }: Params) {
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
        30,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const parsed = saveMaterialRequestSchema.safeParse(body);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', {
          request,
          meta: { fields: validationFields(parsed.error) },
        });
      }

      const data = parsed.data;

      // Ownership is part of the query: another user's material is a 404.
      const existing = await prisma.applicationMaterial.findFirst({
        where: { id, userId },
        select: { id: true, editVersion: true, status: true },
      });
      if (!existing) {
        return apiError('NOT_FOUND', 'Material not found.', { request });
      }

      // Optimistic concurrency: reject silently-clobbering a newer edit.
      if (data.expectedEditVersion !== existing.editVersion) {
        return apiError(
          'CONFLICT',
          'This draft was changed by another tab or device. Reopen it and apply your edit again.',
          { request },
        );
      }

      const updated = await prisma.applicationMaterial.update({
        where: { id },
        data: {
          title: data.title,
          content: data.content,
          subject: data.subject,
          // A manual save marks the draft as user-owned content. It keeps its
          // origin so the provenance chain is not rewritten.
          status: 'READY',
          editVersion: { increment: 1 },
        },
        select: MATERIAL_FIELDS,
      });

      return privateNoStore(
        jsonOk(serialiseMaterialDetail(updated), request),
      );
    },
    { event: 'application_material_save_route_failed', route: ROUTE },
  );
}

export async function DELETE(request: Request, { params }: Params) {
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
        10,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      // Scope the mutation itself to the caller, and make repeated deletes
      // return the same non-disclosing 404 as missing or foreign materials.
      // The revision relation uses SetNull, so successors remain intact.
      const deleted = await prisma.applicationMaterial.deleteMany({
        where: { id, userId },
      });
      if (deleted.count === 0) {
        return apiError('NOT_FOUND', 'Material not found.', { request });
      }

      return privateNoStore(jsonOk({ ok: true }, request));
    },
    { event: 'application_material_delete_route_failed', route: ROUTE },
  );
}

function validationFields(error: z.ZodError) {
  return error.issues.slice(0, 6).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
