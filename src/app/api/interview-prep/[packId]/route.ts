/**
 * One interview preparation pack.
 *
 *   GET    /api/interview-prep/[packId]  -> the pack with its active questions
 *   PATCH  /api/interview-prep/[packId]  -> update title/context/status (archive)
 *   DELETE /api/interview-prep/[packId]  -> archive the pack (soft delete;
 *                                            attempts and questions are kept)
 *
 * Ownership is part of every query, so another user's pack is a 404 — the
 * response never confirms that it exists. Reading never consumes AI credits.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import {
  getPackWithQuestions,
  updatePrepPack,
  type UpdatePrepPackInput,
} from '@/lib/interview-prep/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

const updateSchema = z
  .object({
    title: z.string().min(1).max(160).optional(),
    context: z.string().optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .strict();

type Params = { params: Promise<{ packId: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        RATE_LIMIT,
        RATE_WINDOW_MS,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const { packId } = await params;

      const pack = await getPackWithQuestions({ userId, packId });
      if (!pack) {
        return privateNoStore(
          jsonOk({ available: false, reason: 'PACK_NOT_FOUND' }, request, {
            status: 404,
          }),
        );
      }

      return privateNoStore(
        jsonOk(
          {
            available: true,
            pack,
            // Staleness: true when the inputs that produced this pack have
            // changed underneath it. Practice attempts are never touched by a
            // refresh — they stay attached to the question versions they used.
            isFresh: pack.isFresh,
          },
          request,
        ),
      );
    },
    { event: 'interview_prep_get_failed', route: ROUTE },
  );
}

export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        RATE_LIMIT,
        RATE_WINDOW_MS,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const { packId } = await params;

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        // Empty body is treated as no-op; caller must supply at least one field.
      }

      const parsed = updateSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const input: UpdatePrepPackInput = {};
      if (parsed.data.title !== undefined) input.title = parsed.data.title;
      if (parsed.data.context !== undefined) input.context = parsed.data.context;
      if (parsed.data.status !== undefined) input.status = parsed.data.status;

      const updated = await updatePrepPack({ userId, packId, input });
      if (!updated) {
        return apiError('NOT_FOUND', 'Preparation pack not found.', { request });
      }

      await import('@/lib/observability').then(({ logImportantInfo }) =>
        logImportantInfo({
          event: 'interview_prep_pack_updated',
          userId,
          route: ROUTE,
          context: { packId, updated: Object.keys(input) },
        }),
      );

      return privateNoStore(jsonOk({ pack: updated }, request));
    },
    { event: 'interview_prep_update_failed', route: ROUTE },
  );
}

export async function DELETE(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        RATE_LIMIT,
        RATE_WINDOW_MS,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const { packId } = await params;

      // Deleting a pack means archiving it: questions, answers and feedback
      // are preserved so the user can reopen and see their previous work.
      const updated = await updatePrepPack({ userId, packId, input: { status: 'ARCHIVED' } });
      if (!updated) {
        return apiError('NOT_FOUND', 'Preparation pack not found.', { request });
      }

      await import('@/lib/observability').then(({ logImportantInfo }) =>
        logImportantInfo({
          event: 'interview_prep_pack_archived',
          userId,
          route: ROUTE,
          context: { packId },
        }),
      );

      return privateNoStore(jsonOk({ pack: updated }, request));
    },
    { event: 'interview_prep_delete_failed', route: ROUTE },
  );
}
