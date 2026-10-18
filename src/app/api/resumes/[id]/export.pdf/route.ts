/**
 * PDF export.
 *
 *   GET /api/resumes/[id]/export.pdf
 *
 * A genuine downloadable PDF, generated per request from the AUTHORISED stored
 * document. Not a print dialog, not an HTML page with a download attribute, and
 * not a link to a previously exported file.
 *
 * ── What this endpoint deliberately does NOT do ────────────────────────────
 *
 *  - It does not STORE anything. The bytes exist for one response. There is no
 *    public URL, no blob, no object key. The only way to obtain a resume PDF is
 *    to be its owner and ask for it again.
 *  - It does not call an AI provider. Exporting a saved document consumes no
 *    credit, is not metered, and works identically on Free and on Premium.
 *  - It does not accept any template code, HTML, CSS or script. The renderer is
 *    a switch over three known styles and a fixed geometry. There is nowhere for
 *    a user-supplied string to become markup.
 *  - It does not trust a path. The resume is loaded with `{ id, userId }`, and
 *    the filename in `Content-Disposition` is derived from the server-known
 *    resume name, not from a header or a query parameter.
 *
 * The response is `private, no-store` so a shared cache, a proxy or the browser
 * cannot retain one user's resume on the way to another's screen.
 */

import { auth } from '@/auth';
import { handleRoute } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { getResume } from '@/lib/resume-builder/documents';
import { buildResumeLayoutFromRecord, renderResumePdf } from '@/lib/resume-builder/serve';
import { resumeDownloadHeaders } from '@/lib/resume-builder/download';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/export.pdf';
type Params = { params: Promise<{ id: string }> };

/**
 * Exporting is cheap but not free, so it is rate limited as a burst guard.
 * Deliberately higher than the AI routes: this does not spend provider money.
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const userId = session.user.id;
      const { id } = await params;

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
      if (!rate.ok) {
        return new Response(
          JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many exports. Please wait a moment.' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        );
      }

      let resume;
      try {
        // Ownership is part of the query. Another user's resume is a 404
        // identical in shape to one that does not exist.
        resume = await getResume({ userId, resumeId: id });
      } catch (error) {
        const response = resumeBuilderErrorResponse(error, request);
        response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
        return response;
      }

      const startedAt = Date.now();
      try {
        const layout = await buildResumeLayoutFromRecord(resume);
        const { bytes, pageCount } = await renderResumePdf(layout);

        await logImportantInfo({
          event: 'resume_pdf_exported',
          userId,
          route: ROUTE,
          context: {
            resumeId: resume.id,
            targetJobId: resume.targetJobId,
            pageCount,
            bytes: bytes.byteLength,
            durationMs: Date.now() - startedAt,
          },
        });

        return new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: resumeDownloadHeaders({
            resumeName: resume.name,
            byteLength: bytes.byteLength,
          }),
        });
      } catch (error) {
        await logImportantError({
          event: 'resume_pdf_export_failed',
          userId,
          route: ROUTE,
          error,
          context: { resumeId: resume.id, durationMs: Date.now() - startedAt },
        });
        const response = resumeBuilderErrorResponse(error, request);
        response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
        return response;
      }
    },
    { event: 'resume_pdf_route_failed', route: ROUTE },
  );
}