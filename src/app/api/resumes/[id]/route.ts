/**
 * Single resume API.
 *
 *   GET    /api/resumes/[id]  -> the full document, its layout and the caller's
 *                                entitlements
 *   PATCH  /api/resumes/[id]  -> rename, edit content, change template/accent/
 *                                density, or retarget it at a job
 *   DELETE /api/resumes/[id]  -> delete this resume only
 *
 * The id is resolved with `{ id, userId }` on every path, so another user's
 * resume is a 404 identical in shape to one that does not exist.
 *
 * PATCH carries `expectedRevision`. A mismatch is a 409, not a silent overwrite:
 * two tabs editing the same resume must not be able to lose each other's work.
 * The editor serialises autosaves and uses this revision check to preserve that
 * protection while saving each draft automatically.
 */

import { auth } from '@/auth';
import { touchStreak } from '@/lib/streak';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getEntitlements } from '@/lib/billing/subscriptions';
import {
  deleteResume,
  getResume,
  updateResume,
} from '@/lib/resume-builder/documents';
import { updateResumeSchema } from '@/lib/resume-builder/schema';
import { buildResumeLayoutFromRecord } from '@/lib/resume-builder/serve';
import { RESUME_BUILDER_FEATURE } from '@/lib/resume-builder/entitlements';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { ACCENT_PALETTE, DENSITY_LABELS, TEMPLATE_LIST } from '@/lib/resume-builder/templates';
import { serialiseLayout, serialiseResumeDetail } from '@/lib/resume-builder/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]';
const RATE_LIMIT = 60;
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

      try {
        const [entitlements, resume] = await Promise.all([
          getEntitlements(userId),
          getResume({ userId, resumeId: id }),
        ]);

        const layout = await buildResumeLayoutFromRecord(resume);

        return privateNoStore(
          jsonOk(
            {
              resume: serialiseResumeDetail(resume),
              layout: serialiseLayout(layout),
              templates: TEMPLATE_LIST.map((template) => ({
                key: template.key,
                label: template.label,
                description: template.description,
                atsPrinciples: template.atsPrinciples,
              })),
              accents: Object.entries(ACCENT_PALETTE).map(([key, tokens]) => ({
                key,
                accent: tokens.accent,
                accentDeep: tokens.accentDeep,
                textOnAccent: tokens.textOnAccent,
              })),
              densities: DENSITY_LABELS,
              access: {
                canBuild: entitlements.features[RESUME_BUILDER_FEATURE],
                canOptimize: entitlements.features.RESUME_OPTIMIZATION,
                plan: entitlements.plan,
                isAdmin: entitlements.isAdmin,
                isTrialing: entitlements.isTrialing,
                resumeLimit: entitlements.limits.resumes,
                aiCreditsRemaining: entitlements.limits.aiCredits,
              },
            },
            request,
          ),
        );
      } catch (error) {
        return resumeBuilderErrorResponse(error, request);
      }
    },
    { event: 'resume_get_failed', route: ROUTE },
  );
}

export async function PATCH(request: Request, { params }: Params) {
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
        return apiError('RATE_LIMITED', 'Too many saves. Please wait a moment.', { request });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return apiError('BAD_REQUEST', 'That request was not valid.', { request });
      }

      const parsed = updateResumeSchema.safeParse(body);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Some of those changes could not be saved.', {
          request,
          meta: {
            fields: parsed.error.issues.slice(0, 5).map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        });
      }

      try {
        const updated = await updateResume({ userId, resumeId: id, input: parsed.data });
        await touchStreak(userId).catch(() => null);
        // The layout comes back with the save so the preview reflects exactly
        // what was stored, without a second round trip that could race.
        const layout = await buildResumeLayoutFromRecord(updated);

        return privateNoStore(
          jsonOk(
            {
              resume: serialiseResumeDetail(updated),
              layout: serialiseLayout(layout),
            },
            request,
          ),
        );
      } catch (error) {
        return resumeBuilderErrorResponse(error, request);
      }
    },
    { event: 'resume_update_failed', route: ROUTE },
  );
}

export async function DELETE(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;
      const { id } = await params;

      const rate = applyRateLimit(
        `${ROUTE}:${userId}:${getRequestIp(request)}`,
        10,
        RATE_WINDOW_MS,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      try {
        await deleteResume({ userId, resumeId: id });
        return privateNoStore(jsonOk({ deleted: true }, request));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return resumeBuilderErrorResponse(error, request);
      }
    },
    { event: 'resume_delete_failed', route: ROUTE },
  );
}

