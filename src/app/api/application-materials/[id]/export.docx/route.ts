/** Authenticated editable DOCX export; exporting a saved draft never invokes AI. */

import { auth } from '@/auth';
import { handleRoute, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { downloadHeaders } from '@/lib/application-materials/download';
import { getStoredMaterialContent } from '@/lib/application-materials/wire';
import { buildMaterialExportContext } from '@/lib/application-materials/export-context';
import { renderMaterialDocx } from '@/lib/application-materials/docx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/application-materials/[id]/export.docx';
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

    const material = await prisma.applicationMaterial.findFirst({
      where: { id, userId },
      select: {
        id: true, title: true, content: true, generationMeta: true, status: true, subject: true, type: true,
        job: { select: { userId: true, title: true, company: true } },
        resume: { select: { userId: true, content: true, pageSize: true } },
      },
    });
    if (!material) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Material not found.' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' },
      });
    }

    const startedAt = Date.now();
    try {
      const context = await buildMaterialExportContext({ userId, resume: material.resume, job: material.job });
      const bytes = await renderMaterialDocx({
        type: material.type,
        title: material.title,
        content: getStoredMaterialContent(material),
        subject: material.subject,
        applicant: context.applicant,
        company: context.company,
        jobTitle: context.jobTitle,
        pageSize: context.pageSize,
        date: material.type === 'COVER_LETTER'
          ? new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date())
          : null,
      });
      await logImportantInfo({
        event: 'application_material_docx_exported',
        userId,
        route: ROUTE,
        context: { materialId: material.id, type: material.type, bytes: bytes.byteLength, durationMs: Date.now() - startedAt },
      });
      return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: downloadHeaders({
          fileName: `${safeFileName(material.title)}.docx`,
          byteLength: bytes.byteLength,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      });
    } catch (error) {
      await logImportantError({
        event: 'application_material_docx_export_failed',
        userId,
        route: ROUTE,
        error,
        context: { materialId: material.id, durationMs: Date.now() - startedAt },
      });
      return new Response(JSON.stringify({ error: { code: 'EXPORT_FAILED', message: 'Could not generate the editable document.' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' },
      });
    }
  }, { event: 'application_material_export_docx_route_failed', route: ROUTE }).then(privateNoStore);
}

function safeFileName(title: string): string {
  return title.normalize('NFKD').replace(/[^\w\s.-]+/g, '').trim().replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 80) || 'application-material';
}
