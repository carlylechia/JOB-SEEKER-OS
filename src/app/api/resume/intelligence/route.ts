/**
 * Resume Intelligence API — start and inspect analyses.
 *
 *   GET  /api/resume/intelligence  -> the caller's documents, entitlements and
 *                                     the most recent extraction for each
 *   POST /api/resume/intelligence  -> analyse a document
 *
 * Every response is scoped by the session. There is no userId parameter anywhere
 * in this file, so there is nothing for a caller to swap.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { z } from 'zod';
import { listResumeDocuments } from '@/lib/resume/documents';
import { AI_PRIVACY_NOTICE } from '@/lib/resume/prompt';
import { getResumeModel } from '@/lib/resume/ai-client';
import {
  AI_RESUME_PARSER_FEATURE,
  CAREER_PROFILE_FEATURE,
  runResumeExtraction,
} from '@/lib/resume/service';
import { resumeErrorResponse } from '@/lib/resume/route-errors';
import type { RunExtractionResult } from '@/lib/resume/service';
import { getAiCreditsPayload } from '@/lib/billing/ai-credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resume/intelligence';

/**
 * Burst limit. The monthly credit is the real spend control; this exists to stop
 * a stuck retry loop from hammering the provider in the meantime.
 */
const RATE_LIMIT = 5;
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

      const [documents, entitlements, extractions] = await Promise.all([
        listResumeDocuments(userId),
        getEntitlements(userId),
        prisma.resumeExtraction.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            resumeId: true,
            status: true,
            errorCode: true,
            schemaVersion: true,
            wasTruncated: true,
            createdAt: true,
            completedAt: true,
            model: true,
          },
        }),
      ]);

      // The measured balance, not the plan's ceiling.
      const aiCredits = await getAiCreditsPayload(userId, entitlements.limits.aiCredits);

      return privateNoStore(
        jsonOk(
          {
            documents: documents.map((doc) => ({
              id: doc.id,
              fileName: doc.fileName,
              format: doc.format,
              sizeBytes: doc.sizeBytes,
              isPrimary: doc.isPrimary,
              createdAt: doc.createdAt.toISOString(),
            })),
            extractions: extractions.map((row) => ({
              id: row.id,
              resumeId: row.resumeId,
              status: row.status,
              errorCode: row.errorCode,
              schemaVersion: row.schemaVersion,
              wasTruncated: row.wasTruncated,
              createdAt: row.createdAt.toISOString(),
              completedAt: row.completedAt?.toISOString() ?? null,
              model: row.model,
            })),
            access: {
              canAnalyze: entitlements.features[AI_RESUME_PARSER_FEATURE],
              canUseCareerProfile: entitlements.features[CAREER_PROFILE_FEATURE],
              plan: entitlements.plan,
              isAdmin: entitlements.isAdmin,
              isTrialing: entitlements.isTrialing,
              aiCredits,
            },
            privacyNotice: AI_PRIVACY_NOTICE,
            model: getResumeModel(),
          },
          request,
        ),
      );
    },
    { event: 'resume_intelligence_state_failed', route: ROUTE },
  );
}

const requestSchema = z.object({
  /** Which stored document to analyse. Optional: defaults to the primary. */
  resumeId: z.string().cuid().optional(),
  /**
   * Re-run even when a completed extraction exists for this exact document.
   * Explicitly charged as a new operation.
   */
  force: z.boolean().optional(),
});

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
        return apiError('RATE_LIMITED', 'Too many analysis requests. Please wait a moment.', {
          request,
        });
      }

      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        // An empty body is a legitimate request: analyse my primary resume.
      }

      const parsed = requestSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That request was not valid.', { request });
      }

      let result: RunExtractionResult;
      try {
        result = await runResumeExtraction({
          userId,
          resumeId: parsed.data.resumeId,
          force: parsed.data.force === true,
          route: ROUTE,
        });
      } catch (error) {
        // Domain failures are responses, not crashes. Anything genuinely
        // unexpected is re-thrown and handled by handleRoute's logged 500.
        return resumeErrorResponse(error, request);
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
            extractionId: result.extraction.id,
            resumeId: result.extraction.resumeId,
            status: result.extraction.status,
            wasTruncated: result.extraction.wasTruncated,
            model: result.extraction.model,
            createdAt: result.extraction.createdAt.toISOString(),
            completedAt: result.extraction.completedAt?.toISOString() ?? null,
            reviewUrl: `/career-profile?extraction=${result.extraction.id}`,
            ...(result.outcome === 'COMPLETED' ? { creditsConsumed: result.creditsConsumed } : {}),
          },
          request,
        ),
      );
    },
    { event: 'resume_parse_failed', route: ROUTE },
  );
}