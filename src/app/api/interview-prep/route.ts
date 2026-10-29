/**
 * Interview preparation packs API.
 *
 *   GET  /api/interview-prep  -> list the caller's packs (optionally ?jobId=)
 *                                with entitlement metadata
 *   POST /api/interview-prep  -> create (or reuse) a pack. Job-based packs can
 *                                be generated immediately; a manual pack can be
 *                                saved as a draft first.
 *
 * Every response is scoped by the session. There is no `userId` parameter
 * anywhere in this file, so there is nothing for a caller to swap — and the
 * job id is resolved ownership-scoped inside the service layer, so another
 * user's job is a 404 rather than a 403.
 *
 * Reading a saved pack never consumes AI credits. Only generating or
 * refreshing a pack is metered through the shared aiCredits allowance.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { getEntitlements, requireEntitlement } from '@/lib/billing/subscriptions';
import { INTERVIEW_PREP_FEATURE } from '@/lib/interview-prep/service';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import {
  createPrepPack,
  generatePrepPack,
  listPrepPacks,
} from '@/lib/interview-prep/service';
import {
  interviewContextSchema,
  prepTimingSchema,
} from '@/lib/interview-prep/schema';
import { INTERVIEW_PREP_MAX_RESEARCH_URLS } from '@/lib/interview-prep/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep';

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const urlText = z.string().trim().max(2_048).optional().nullable();

const createSchema = z
  .object({
    jobId: z.string().min(1).optional().nullable(),
    title: z.string().trim().min(1).max(160).optional(),
    company: z.string().trim().min(1).max(160).optional(),
    roleTitle: z.string().trim().min(1).max(200).optional(),
    location: optionalText(200),
    jobUrl: urlText,
    jobDescription: optionalText(60_000),
    companyWebsiteUrl: urlText,
    careersUrl: urlText,
    researchUrls: z.array(z.string().trim().min(1).max(2_048)).max(INTERVIEW_PREP_MAX_RESEARCH_URLS).optional(),
    interviewAt: z.string().datetime({ offset: true }).optional().nullable(),
    timing: prepTimingSchema.optional(),
    context: interviewContextSchema.default('BALANCED'),
    interviewFormat: interviewContextSchema.optional(),
    interviewLanguage: optionalText(80),
    interviewerInfo: optionalText(2_000),
    invitationNotes: optionalText(2_000),
    concerns: optionalText(1_200),
    focusTopics: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
    force: z.boolean().optional(),
    generate: z.boolean().optional(),
  })
  .strict();

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        RATE_LIMIT * 3,
        RATE_WINDOW_MS,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      const entitlements = await getEntitlements(userId);

      const { searchParams } = new URL(request.url);
      const jobId = searchParams.get('jobId') || undefined;
      const includeArchived = searchParams.get('includeArchived') === 'true';

      const packs = await listPrepPacks({ userId, jobId, includeArchived });

      return privateNoStore(
        jsonOk(
          {
            packs,
            access: {
              canGenerate: entitlements.features[INTERVIEW_PREP_FEATURE],
              plan: entitlements.plan,
              aiCreditsRemaining: entitlements.limits.aiCredits,
            },
          },
          request,
        ),
      );
    },
    { event: 'interview_prep_list_failed', route: ROUTE },
  );
}

export async function POST(request: Request) {
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
        // Validation below supplies the error.
      }

      const parsed = createSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', {
          request,
          meta: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        });
      }

      const input = parsed.data;
      const generate = input.generate !== false;

      if (generate) {
        try {
          await requireEntitlement(userId, INTERVIEW_PREP_FEATURE);
        } catch (error) {
          return interviewPrepErrorResponse(error, request);
        }
      }

      let created: Awaited<ReturnType<typeof createPrepPack>>;
      try {
        created = await createPrepPack({
          userId,
          jobId: input.jobId ?? null,
          title: input.title ?? null,
          company: input.company ?? null,
          roleTitle: input.roleTitle ?? null,
          location: input.location ?? null,
          jobUrl: input.jobUrl ?? null,
          jobDescription: input.jobDescription ?? null,
          companyWebsiteUrl: input.companyWebsiteUrl ?? null,
          careersUrl: input.careersUrl ?? null,
          researchUrls: input.researchUrls ?? [],
          interviewAt: input.interviewAt ? new Date(input.interviewAt) : null,
          timing: input.timing,
          context: input.context,
          interviewFormat: input.interviewFormat ?? input.context,
          interviewLanguage: input.interviewLanguage ?? null,
          interviewerInfo: input.interviewerInfo ?? null,
          invitationNotes: input.invitationNotes ?? null,
          concerns: input.concerns ?? null,
          focusTopics: input.focusTopics ?? [],
          force: input.force === true,
        });
      } catch (error) {
        return interviewPrepErrorResponse(error, request);
      }

      if (!generate) {
        return privateNoStore(
          jsonOk({ outcome: 'DRAFT', pack: created.pack, reused: created.reused }, request),
        );
      }

      let result: Awaited<ReturnType<typeof generatePrepPack>>;
      try {
        result = await generatePrepPack({
          userId,
          packId: created.pack.id,
          force: input.force === true,
          route: ROUTE,
        });
      } catch (error) {
        return interviewPrepErrorResponse(error, request);
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
            pack: result.pack ?? created.pack,
            data: result.data,
            reused: created.reused,
            ...(result.outcome === 'COMPLETED' ? { creditsConsumed: result.creditsConsumed } : {}),
          },
          request,
        ),
      );
    },
    { event: 'interview_prep_route_failed', route: ROUTE },
  );
}
