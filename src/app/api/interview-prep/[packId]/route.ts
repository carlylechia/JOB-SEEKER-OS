/**
 * One interview preparation pack.
 *
 *   GET    /api/interview-prep/[packId]  -> the pack, its generated sections,
 *                                           research sources, tasks, sessions
 *                                           and readiness summary
 *   PATCH  /api/interview-prep/[packId]  -> update metadata / interview date /
 *                                           research URLs, or archive
 *   DELETE /api/interview-prep/[packId]  -> archive the pack (soft delete;
 *                                           attempts and questions are kept)
 *
 * Ownership is part of every query, so another user's pack is a 404 — the
 * response never confirms that it exists. Reading never consumes AI credits.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit } from '@/lib/rate-limit';
import { getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import { getPrepPack, updatePrepPack, type UpdatePrepPackInput } from '@/lib/interview-prep/service';
import {
  interviewContextSchema,
  prepTimingSchema,
  type InterviewContext,
  type PrepTiming,
} from '@/lib/interview-prep/schema';
import { INTERVIEW_PREP_MAX_RESEARCH_URLS } from '@/lib/interview-prep/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/[packId]';

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const urlText = z.string().trim().max(2_048).optional().nullable();

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    company: z.string().trim().min(1).max(160).optional(),
    roleTitle: z.string().trim().min(1).max(200).optional(),
    location: optionalText(200),
    jobUrl: urlText,
    jobDescription: optionalText(60_000),
    companyWebsiteUrl: urlText,
    careersUrl: urlText,
    researchUrls: z
      .array(z.string().trim().min(1).max(2_048))
      .max(INTERVIEW_PREP_MAX_RESEARCH_URLS)
      .optional(),
    interviewAt: z.string().datetime({ offset: true }).optional().nullable(),
    timing: prepTimingSchema.optional(),
    context: interviewContextSchema.optional(),
    interviewFormat: interviewContextSchema.optional(),
    interviewLanguage: optionalText(80),
    interviewerInfo: optionalText(2_000),
    invitationNotes: optionalText(2_000),
    concerns: optionalText(1_200),
    focusTopics: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
    status: z.enum(['DRAFT', 'ARCHIVED']).optional(),
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
      const detail = await getPrepPack({ userId, packId });
      if (!detail) {
        return apiError('NOT_FOUND', 'Preparation pack not found.', { request });
      }

      return privateNoStore(
        jsonOk(
          {
            available: true,
            pack: detail.pack,
            data: detail.data,
            sources: detail.sources,
            tasks: detail.tasks,
            sessions: detail.sessions,
            readiness: detail.readiness,
            practicedQuestionIds: detail.practicedQuestionIds,
            feedbackQuestionIds: detail.feedbackQuestionIds,
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

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        // Empty body is treated as no-op; validation requires at least one field.
      }

      const parsed = updateSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', {
          request,
          meta: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        });
      }

      const { packId } = await params;
      const data = parsed.data;
      const input: UpdatePrepPackInput = {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.company !== undefined ? { company: data.company } : {}),
        ...(data.roleTitle !== undefined ? { roleTitle: data.roleTitle } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.jobUrl !== undefined ? { jobUrl: data.jobUrl } : {}),
        ...(data.jobDescription !== undefined ? { jobDescription: data.jobDescription } : {}),
        ...(data.companyWebsiteUrl !== undefined ? { companyWebsiteUrl: data.companyWebsiteUrl } : {}),
        ...(data.careersUrl !== undefined ? { careersUrl: data.careersUrl } : {}),
        ...(data.researchUrls !== undefined ? { researchUrls: data.researchUrls } : {}),
        ...(data.interviewAt !== undefined
          ? { interviewAt: data.interviewAt ? new Date(data.interviewAt) : null }
          : {}),
        ...(data.timing !== undefined ? { timing: data.timing as PrepTiming } : {}),
        ...(data.context !== undefined ? { context: data.context as InterviewContext } : {}),
        ...(data.interviewFormat !== undefined
          ? { interviewFormat: data.interviewFormat as InterviewContext }
          : {}),
        ...(data.interviewLanguage !== undefined ? { interviewLanguage: data.interviewLanguage } : {}),
        ...(data.interviewerInfo !== undefined ? { interviewerInfo: data.interviewerInfo } : {}),
        ...(data.invitationNotes !== undefined ? { invitationNotes: data.invitationNotes } : {}),
        ...(data.concerns !== undefined ? { concerns: data.concerns } : {}),
        ...(data.focusTopics !== undefined ? { focusTopics: data.focusTopics } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      };

      let updated: Awaited<ReturnType<typeof updatePrepPack>>;
      try {
        updated = await updatePrepPack({ userId, packId, input });
      } catch (error) {
        return interviewPrepErrorResponse(error, request);
      }
      if (!updated) {
        return apiError('NOT_FOUND', 'Preparation pack not found.', { request });
      }

      const log = await import('@/lib/observability');
      await log.logImportantInfo({
        event: 'interview_prep_pack_updated',
        userId,
        route: ROUTE,
        context: { packId, updated: Object.keys(input) },
      });

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

      const log = await import('@/lib/observability');
      await log.logImportantInfo({
        event: 'interview_prep_pack_archived',
        userId,
        route: ROUTE,
        context: { packId },
      });

      return privateNoStore(jsonOk({ pack: updated }, request));
    },
    { event: 'interview_prep_delete_failed', route: ROUTE },
  );
}
