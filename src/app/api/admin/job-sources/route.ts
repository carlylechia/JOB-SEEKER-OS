import { NextResponse } from 'next/server';
import { getCurrentAdmin } from '@/lib/authz';
import { listSourceHealth } from '@/lib/job-discovery/source-health';
import { jsonError, jsonOk } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return jsonError('Unauthorized', 401, undefined, request);
  const rows = await listSourceHealth();
  return jsonOk({ sources: rows }, request);
}
