import { NextResponse } from 'next/server';
import { getCurrentAdmin } from '@/lib/authz';
import { listSourceHealth, recentCatalogRuns } from '@/lib/job-discovery/source-health';
import { runCatalogSync } from '@/lib/job-discovery/catalog/sync';
import { prisma } from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return jsonError('Unauthorized', 401, undefined, request);
  const [sources, registry, runs] = await Promise.all([
    listSourceHealth(),
    prisma.jobSource.findMany({ orderBy: [{ provider: 'asc' }, { displayName: 'asc' }] }),
    recentCatalogRuns(10),
  ]);
  return jsonOk({ sources, registry, recentRuns: runs }, request);
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return jsonError('Unauthorized', 401, undefined, request);

  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'sync') {
      const syncRun = await runCatalogSync({
        trigger: 'admin',
        sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds : undefined,
      });
      return jsonOk({ ok: true, syncRun }, request);
    }

    if (body.action === 'toggle' && typeof body.id === 'string' && typeof body.enabled === 'boolean') {
      const updated = await prisma.jobSource.update({
        where: { id: body.id },
        data: { enabled: body.enabled },
      });
      return jsonOk({ ok: true, source: updated }, request);
    }

    return jsonError('Invalid action', 400, undefined, request);
  } catch (error) {
    return jsonError('Operation failed', 500, [error instanceof Error ? error.message : 'Unknown error'], request);
  }
}
