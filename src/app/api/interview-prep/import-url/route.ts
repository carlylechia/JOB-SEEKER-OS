/**
 * Import a job posting's readable text from a URL.
 *
 *   POST /api/interview-prep/import-url
 *
 * The fetch is server-side, bounded and SSRF-protected (public DNS only, no
 * credentials, standard ports, redirect revalidation, size and time limits).
 * The returned text is shown to the candidate for review before it is saved;
 * nothing is generated here and no AI credits are consumed.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { interviewPrepErrorResponse } from '@/lib/interview-prep/route-errors';
import { importPrepJobUrl } from '@/lib/interview-prep/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/interview-prep/import-url';

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const importSchema = z.object({ url: z.string().trim().min(1).max(2_048) }).strict();

export async function OPTIONS(request: Request) {
  return handleOptions(request);
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

      const parsed = importSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Paste a valid job posting URL.', { request });
      }

      try {
        const imported = await importPrepJobUrl(parsed.data.url);
        return privateNoStore(jsonOk({ imported }, request));
      } catch (error) {
        return interviewPrepErrorResponse(error, request);
      }
    },
    { event: 'interview_prep_import_url_failed', route: ROUTE },
  );
}
