/**
 * AI application materials — PDF export.
 *
 *   GET /api/application-materials/[id]/export.pdf
 *
 * A genuine downloadable PDF, generated per request from the authorised saved
 * material. Reuses the resume builder's pdf-lib renderer
 * (`preparePdfLayout` / `renderPdfLayout`) rather than introducing a second
 * PDF stack.
 *
 * Exporting a saved document consumes no AI credit and is not metered.
 */

import { auth } from '@/auth';
import { handleRoute } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { preparePdfEngine, getLayoutMetrics, renderPdfLayout } from '@/lib/resume-builder/pdf';
import { buildLetterLayout } from '@/lib/application-materials/letter-layout';
import { downloadHeaders } from '@/lib/application-materials/download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/application-materials/[id]/export.pdf';

type Params = { params: Promise<{ id: string }> };

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

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 20, 60_000);
      if (!rate.ok) {
        return new Response(
          JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many exports. Please wait a moment.' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const material = await prisma.applicationMaterial.findFirst({
        where: { id, userId },
        select: { id: true, title: true, content: true, type: true },
      });

      if (!material) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Material not found.' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const startedAt = Date.now();
      try {
        await preparePdfEngine();
        const layout = buildLetterLayout({ content: material.content });
        getLayoutMetrics();
        const { bytes, pageCount } = await renderPdfLayout(layout);

        await logImportantInfo({
          event: 'application_material_pdf_exported',
          userId,
          route: ROUTE,
          context: {
            materialId: material.id,
            type: material.type,
            pageCount,
            bytes: bytes.byteLength,
            durationMs: Date.now() - startedAt,
          },
        });

        return new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: downloadHeaders({
            fileName: `${safeFileName(material.title)}.pdf`,
            byteLength: bytes.byteLength,
            contentType: 'application/pdf',
          }),
        });
      } catch (error) {
        await logImportantError({
          event: 'application_material_pdf_export_failed',
          userId,
          route: ROUTE,
          error,
          context: { materialId: material.id, durationMs: Date.now() - startedAt },
        });
        return new Response(JSON.stringify({ error: { code: 'AI_UNAVAILABLE', message: 'Could not generate the PDF.' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    },
    { event: 'application_material_export_pdf_route_failed', route: ROUTE },
  );
}

function safeFileName(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80) || 'application-material';
}
