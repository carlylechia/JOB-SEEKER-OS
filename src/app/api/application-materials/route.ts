/**
 * AI application materials — library.
 *
 *   GET /api/application-materials
 *
 * Lists the caller's own materials, most recent first, scoped by session
 * userId. Archiving a material hides it; it is never exposed to another user
 * and never included in public job data.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { materialTypeSchema } from '@/lib/application-materials/materials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/application-materials';

const LIST_FIELDS = {
  id: true,
  type: true,
  title: true,
  subject: true,
  status: true,
  origin: true,
  generationStatus: true,
  jobId: true,
  resumeId: true,
  templateId: true,
  revision: true,
  supersedesId: true,
  createdAt: true,
  updatedAt: true,
  errorCode: true,
  thinInputs: true,
  editVersion: true,
  job: { select: { id: true, title: true, company: true, status: true, deletedAt: true } },
} as const;

const listSchema = z
  .object({
    type: materialTypeSchema.optional(),
    status: z.enum(['DRAFT', 'READY', 'ARCHIVED']).optional(),
    /** Scope the library to one application kit. */
    jobId: z.string().min(1).max(64).optional(),
    take: z.coerce.number().min(1).max(100).default(50),
    cursor: z.string().max(64).optional(),
  })
  .strict();

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const userId = session.user.id;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        30,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const url = new URL(request.url);
      const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const { type, status, jobId, take, cursor } = parsed.data;

      const materials = await prisma.applicationMaterial.findMany({
        where: {
          userId,
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
          ...(jobId ? { jobId } : {}),
        },
        select: LIST_FIELDS,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const nextCursor = materials.length === take ? materials[materials.length - 1].id : null;

      return privateNoStore(
        jsonOk(
          {
            materials,
            nextCursor,
            count: materials.length,
          },
          request,
        ),
      );
    },
    { event: 'application_material_list_route_failed', route: ROUTE },
  );
}
