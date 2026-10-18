/**
 * GET /api/resume/intelligence/[extractionId]
 *
 * Returns one completed extraction as a ready-to-edit review, alongside the
 * caller's current profile values so conflicts can be shown side by side.
 *
 * The extraction is loaded with `{ id, userId }`. Another user's extraction is
 * a 404, exactly like one that does not exist — the response never confirms
 * that someone else's resume was analysed.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { buildReviewPayload, extractionToReviewDefaults } from '@/lib/resume/career-profile';
import { CAREER_PROFILE_FEATURE, getExtractionForReview } from '@/lib/resume/service';
import { resumeErrorResponse } from '@/lib/resume/route-errors';
import { countReviewFlags } from '@/lib/resume/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resume/intelligence/[extractionId]';

type Context = { params: Promise<{ extractionId: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, context: Context) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      const userId = session.user.id;

      const { extractionId } = await context.params;

      let result: Awaited<ReturnType<typeof getExtractionForReview>>;
      try {
        result = await getExtractionForReview({ userId, extractionId });
      } catch (error) {
        return resumeErrorResponse(error, request);
      }

      const [profile, user, entitlements] = await Promise.all([
        prisma.userProfile.findUnique({
          where: { userId },
          select: {
            headline: true,
            phone: true,
            summary: true,
            location: true,
            linkedinUrl: true,
            portfolioUrl: true,
            websiteUrl: true,
            careerProfileVersion: true,
          },
        }),
        prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
        getEntitlements(userId),
      ]);

      const review = buildReviewPayload({
        extraction: result.data,
        profile: {
          fullName: user?.name ?? null,
          headline: profile?.headline ?? null,
          phone: profile?.phone ?? null,
          summary: profile?.summary ?? null,
          location: profile?.location ?? null,
          linkedinUrl: profile?.linkedinUrl ?? null,
          portfolioUrl: profile?.portfolioUrl ?? null,
          websiteUrl: profile?.websiteUrl ?? null,
          careerProfileVersion: profile?.careerProfileVersion ?? 0,
        },
      });

      return privateNoStore(
        jsonOk(
          {
            extraction: {
              id: result.extraction.id,
              resumeId: result.extraction.resumeId,
              status: result.extraction.status,
              wasTruncated: result.extraction.wasTruncated,
              model: result.extraction.model,
              createdAt: result.extraction.createdAt.toISOString(),
              completedAt: result.extraction.completedAt?.toISOString() ?? null,
            },
            resume: result.resume,
            data: result.data,
            review,
            defaults: extractionToReviewDefaults(result.data),
            reviewFlags: countReviewFlags(result.data),
            canApply: entitlements.features[CAREER_PROFILE_FEATURE],
          },
          request,
        ),
      );
    },
    { event: 'resume_extraction_review_failed', route: ROUTE },
  );
}