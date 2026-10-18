/**
 * Resume collection API.
 *
 *   GET  /api/resumes  -> the caller's resumes, their plan limit and whether
 *                         they have a confirmed career profile to build from
 *   POST /api/resumes  -> create one, from their profile, blank, or a duplicate
 *
 * Every response is scoped by the session. There is no `userId` parameter
 * anywhere in this file, so there is nothing for a caller to swap.
 * `sourceResumeId` and `targetJobId` arrive as request data but are re-resolved
 * against rows the caller owns before they are used.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getEntitlements, requireEntitlement } from '@/lib/billing/subscriptions';
import {
  careerProfileSummary,
  createResume,
  listResumes,
} from '@/lib/resume-builder/documents';
import { createResumeSchema } from '@/lib/resume-builder/schema';
import { RESUME_BUILDER_FEATURE } from '@/lib/resume-builder/entitlements';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { ACCENT_PALETTE, DENSITY_LABELS, TEMPLATE_LIST } from '@/lib/resume-builder/templates';
import { serialiseResume } from '@/lib/resume-builder/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes';
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;
      const [entitlements, resumes, profile] = await Promise.all([
        getEntitlements(userId),
        listResumes(userId),
        careerProfileSummary(userId),
      ]);

      return privateNoStore(
        jsonOk(
          {
            resumes: resumes.map(serialiseResume),
            careerProfile: profile,
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
              resumesUsed: resumes.length,
            },
          },
          request,
        ),
      );
    },
    { event: 'resumes_list_failed', route: ROUTE },
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

      // Strict: an unexpected field is an error, not something to ignore. A
      // payload carrying `userId`, `plan` or `revision` must not validate.
      const parsed = createResumeSchema.safeParse(await readBody(request));
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', {
          request,
          meta: { fields: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join('.')) },
        });
      }

      try {
        // Server-side gate. The UI already hides the button, but a hidden button
        // is not an authorisation check.
        await requireEntitlement(userId, RESUME_BUILDER_FEATURE);

        const entitlements = await getEntitlements(userId);
        const created = await createResume({
          userId,
          input: parsed.data,
          limit: entitlements.limits.resumes,
        });

        return privateNoStore(jsonOk({ resume: serialiseResume(created) }, request, { status: 201 }));
      } catch (error) {
        return resumeBuilderErrorResponse(error, request);
      }
    },
    { event: 'resume_create_failed', route: ROUTE },
  );
}

/** An empty body is a legitimate "create a blank resume". */
async function readBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    return text.length === 0 ? {} : JSON.parse(text);
  } catch {
    return null;
  }
}