import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { preparePdfEngine, getLayoutMetrics } from '@/lib/resume-builder/pdf';
import { buildLetterLayout } from '@/lib/application-materials/letter-layout';
import { buildMaterialExportContext } from '@/lib/application-materials/export-context';
import { getStoredMaterialContent } from '@/lib/application-materials/wire';
import type { LayoutDocument } from '@/lib/resume-builder/layout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/application-materials/[id]/preview';

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      const userId = session.user.id;
      const { id } = await params;

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 30, 60_000);
      if (!rate.ok) return apiError('RATE_LIMITED', 'Too many requests.', { request });

      const material = await prisma.applicationMaterial.findFirst({
        where: { id, userId },
        select: {
          id: true, type: true, content: true, subject: true,
          job: { select: { userId: true, title: true, company: true } },
          resume: { select: { userId: true, content: true, pageSize: true } },
        },
      });
      if (!material) return apiError('NOT_FOUND', 'Material not found.', { request });

      await preparePdfEngine();
      const context = await buildMaterialExportContext({ userId, resume: material.resume, job: material.job });
      const isCoverLetter = material.type === 'COVER_LETTER';
      const layout = buildLetterLayout({
        content: getStoredMaterialContent(material as any),
        metrics: getLayoutMetrics(),
        pageSize: context.pageSize,
        applicant: isCoverLetter ? context.applicant : null,
        date: isCoverLetter ? new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date()) : null,
        company: isCoverLetter ? context.company : null,
        jobTitle: isCoverLetter ? context.jobTitle : null,
        subject: isCoverLetter ? material.subject : null,
      });

      return privateNoStore(jsonOk({ layout }, request));
    },
    { event: 'application_material_preview_route_failed', route: ROUTE },
  );
}
