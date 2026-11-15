/**
 * Download every generated application material for a job as one ZIP.
 *
 *   GET /api/jobs/[id]/application-materials/export.zip
 *
 * Read-only: it never calls a provider or consumes a credit. Each material is
 * written as a plain-text file so the archive opens on any machine.
 */

import { auth } from '@/auth';
import { handleRoute } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { downloadHeaders } from '@/lib/application-materials/download';
import { getStoredMaterialContent } from '@/lib/application-materials/wire';
import { createZip } from '@/lib/application-materials/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/jobs/[id]/application-materials/export.zip';

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
      const { id: jobId } = await params;

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 10, 60_000);
      if (!rate.ok) {
        return new Response(
          JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many downloads. Please wait a moment.' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const materials = await prisma.applicationMaterial.findMany({
        where: { userId, jobId },
        select: {
          id: true,
          title: true,
          content: true,
          generationMeta: true,
          status: true,
          type: true,
          subject: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (materials.length === 0) {
        return new Response(
          JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No application materials found for this job.' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const usedNames = new Set<string>();
      const entries = materials.map((material) => {
        const base = safeFileName(material.title);
        let name = `${base}.txt`;
        let counter = 2;
        while (usedNames.has(name)) {
          name = `${base}-${counter}.txt`;
          counter += 1;
        }
        usedNames.add(name);

        const text = buildPlainText({
          ...material,
          content: getStoredMaterialContent(material),
        });
        return { name, data: Buffer.from(text, 'utf8') };
      });

      const zip = createZip(entries);

      return new Response(zip as unknown as BodyInit, {
        status: 200,
        headers: downloadHeaders({
          fileName: `application-materials-${jobId}.zip`,
          byteLength: zip.byteLength,
          contentType: 'application/zip',
        }),
      });
    },
    { event: 'application_materials_export_zip_route_failed', route: ROUTE },
  );
}

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

function safeFileName(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[^\w\s.-]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 80) || 'application-material'
  );
}