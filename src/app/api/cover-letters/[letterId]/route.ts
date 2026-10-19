/**
 * One cover letter.
 *
 *   GET    /api/cover-letters/[letterId]  -> the letter with its claims
 *   PATCH  /api/cover-letters/[letterId]  -> update title/content/subject/salutation/signOff/status
 *   DELETE /api/cover-letters/[letterId]  -> archive the letter (soft delete;
 *                                            content is kept so the user can
 *                                            reopen and see their previous work)
 *
 * Ownership is part of every query, so another user's letter is a 404 — the
 * response never confirms that it exists. Reading never consumes AI credits.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { coverLetterErrorResponse } from '@/lib/cover-letter/route-errors';
import {
  getLetterWithClaims,
  updateCoverLetter,
  type UpdateCoverLetterInput,
} from '@/lib/cover-letter/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/cover-letters/[letterId]';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

const updateSchema = z
  .object({
    title: z.string().min(1).max(160).optional(),
    content: z.string().max(10000).optional(),
    subject: z.string().max(160).optional().nullable(),
    salutation: z.string().max(120).optional().nullable(),
    signOff: z.string().max(120).optional().nullable(),
    status: z.enum(['DRAFT', 'GENERATED', 'SENT', 'ARCHIVED']).optional(),
  })
  .strict();

type Params = { params: Promise<{ letterId: string }> };

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

      const { letterId } = await params;

      const letter = await getLetterWithClaims({ userId, letterId });
      if (!letter) {
        return privateNoStore(
          jsonOk({ available: false, reason: 'LETTER_NOT_FOUND' }, request, {
            status: 404,
          }),
        );
      }

      return privateNoStore(jsonOk({ available: true, letter }, request));
    },
    { event: 'cover_letter_get_failed', route: ROUTE },
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

      const { letterId } = await params;

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        // Empty body is treated as no-op.
      }

      const parsed = updateSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      const input: UpdateCoverLetterInput = {};
      if (parsed.data.title !== undefined) input.title = parsed.data.title;
      if (parsed.data.content !== undefined) input.content = parsed.data.content;
      if (parsed.data.subject !== undefined) input.subject = parsed.data.subject;
      if (parsed.data.salutation !== undefined) input.salutation = parsed.data.salutation;
      if (parsed.data.signOff !== undefined) input.signOff = parsed.data.signOff;
      if (parsed.data.status !== undefined) input.status = parsed.data.status;

      const updated = await updateCoverLetter({ userId, letterId, input });
      if (!updated) {
        return apiError('NOT_FOUND', 'Cover letter not found.', { request });
      }

      await import('@/lib/observability').then(({ logImportantInfo }) =>
        logImportantInfo({
          event: 'cover_letter_updated',
          userId,
          route: ROUTE,
          context: { letterId, updated: Object.keys(input) },
        }),
      );

      return privateNoStore(jsonOk({ letter: updated }, request));
    },
    { event: 'cover_letter_update_failed', route: ROUTE },
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

      const { letterId } = await params;

      // Archiving keeps content and history so the user can reopen it.
      const updated = await updateCoverLetter({ userId, letterId, input: { status: 'ARCHIVED' } });
      if (!updated) {
        return apiError('NOT_FOUND', 'Cover letter not found.', { request });
      }

      await import('@/lib/observability').then(({ logImportantInfo }) =>
        logImportantInfo({
          event: 'cover_letter_archived',
          userId,
          route: ROUTE,
          context: { letterId },
        }),
      );

      return privateNoStore(jsonOk({ letter: updated }, request));
    },
    { event: 'cover_letter_delete_failed', route: ROUTE },
  );
}
