/**
 * AI application materials — plain-text export.
 *
 *   GET /api/application-materials/[id]/export.txt
 *
 * A reliable downloadable plain-text file of the saved material. Copying and
 * downloading never invoke a provider and never consume a credit.
 */

import { auth } from '@/auth';
import { handleRoute } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { downloadHeaders } from '@/lib/application-materials/download';
import { getStoredMaterialContent } from '@/lib/application-materials/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/application-materials/[id]/export.txt';

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
        select: {
          id: true, title: true, content: true, generationMeta: true, status: true, type: true, subject: true,
        },
      });

      if (!material) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Material not found.' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const text = buildPlainText({
        ...material,
        content: getStoredMaterialContent(material),
      });
      const bytes = new TextEncoder().encode(text);

      return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: downloadHeaders({
          fileName: `${safeFileName(material.title)}.txt`,
          byteLength: bytes.byteLength,
          contentType: 'text/plain; charset=utf-8',
        }),
      });
    },
    { event: 'application_material_export_txt_route_failed', route: ROUTE },
  );
}

/**
 * Assemble the plain-text file: optional subject, then body, with nothing
 * hidden. Internal metadata is never included.
 */
function buildPlainText(material: {
  title: string;
  content: string;
  type: string;
  subject: string | null;
}): string {
  const parts: string[] = [];
  if (material.subject) parts.push(`Subject: ${material.subject}`);
  parts.push(material.content);
  return parts.join('\n\n');
}

/** Safe filename derived only from the server-known title. */
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
