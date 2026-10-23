/** Authenticated editable DOCX export; generating a file never invokes AI. */

import { auth } from '@/auth';
import { handleRoute, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { getResume } from '@/lib/resume-builder/documents';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { renderResumeDocx } from '@/lib/resume-builder/docx';
import { resumeDocumentDownloadHeaders } from '@/lib/resume-builder/download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/export.docx';
type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userId = session.user.id;
    const { id } = await params;
    const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 20, 60_000);
    if (!rate.ok) {
      return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many exports. Please wait a moment.' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let resume;
    try {
      resume = await getResume({ userId, resumeId: id });
    } catch (error) {
      const response = resumeBuilderErrorResponse(error, request);
      response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
      return response;
    }

    const startedAt = Date.now();
    try {
      const bytes = await renderResumeDocx({
        content: resume.content,
        templateKey: resume.templateKey,
        pageSize: resume.pageSize,
        accentKey: resume.accentKey,
        compact: resume.origin === 'ONE_PAGE',
      });
      await logImportantInfo({
        event: 'resume_docx_exported',
        userId,
        route: ROUTE,
        context: { resumeId: resume.id, targetJobId: resume.targetJobId, bytes: bytes.byteLength, durationMs: Date.now() - startedAt },
      });
      return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: resumeDocumentDownloadHeaders({
          resumeName: resume.name,
          byteLength: bytes.byteLength,
          extension: 'docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      });
    } catch (error) {
      await logImportantError({
        event: 'resume_docx_export_failed',
        userId,
        route: ROUTE,
        error,
        context: { resumeId: resume.id, durationMs: Date.now() - startedAt },
      });
      const response = resumeBuilderErrorResponse(error, request);
      response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
      return response;
    }
  }, { event: 'resume_docx_route_failed', route: ROUTE }).then(privateNoStore);
}
