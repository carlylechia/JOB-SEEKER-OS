import { handleOptions } from '@/lib/cors';
import { jsonError, jsonOk } from '@/lib/api';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantError } from '@/lib/observability';
import { getPublicJobs } from '@/lib/public-jobs';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request) {
  const rate = applyRateLimit(`public-jobs:list:${getRequestIp(request)}`, 60, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() ?? '';
    const takeParam = Number(searchParams.get('take') ?? '40');

    const jobs = await getPublicJobs({
      q,
      take: takeParam,
    });

    return jsonOk({ jobs }, request);
  } catch (error) {
    await logImportantError({
      event: 'public_jobs_fetch_failed',
      route: '/api/public-jobs',
      error,
      context: {
        method: 'GET',
      },
    });

    return jsonError('Unable to fetch public jobs', 500, undefined, request);
  }
}