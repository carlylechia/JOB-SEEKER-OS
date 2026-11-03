import { handleOptions } from '@/lib/cors';
import { jsonError, jsonOk } from '@/lib/api';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantError } from '@/lib/observability';
import {
  clampPublicJobsTake,
  getPublicJobs,
  normalizePublicJobsSearchQuery,
  normalizePublicJobsSort,
} from '@/lib/public-jobs';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

function readNumber(value: string | null): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  const rate = applyRateLimit(`public-jobs:list:${getRequestIp(request)}`, 60, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const { searchParams } = new URL(request.url);
    const days = readNumber(searchParams.get('days'));
    const take = readNumber(searchParams.get('take'));
    const page = readNumber(searchParams.get('page'));

    const result = await getPublicJobs({
      q: normalizePublicJobsSearchQuery(searchParams.get('q')),
      title: searchParams.get('title')?.trim() ?? '',
      days: days ?? 30,
      take: clampPublicJobsTake(take),
      page: page && page > 0 ? Math.floor(page) : 1,
      category: searchParams.get('category')?.trim() ?? '',
      remoteType: searchParams.get('remoteType')?.trim() ?? '',
      seniority: searchParams.get('seniority')?.trim() ?? '',
      employmentType: searchParams.get('employmentType')?.trim() ?? '',
      source: searchParams.get('source')?.trim() ?? '',
      minSalary: readNumber(searchParams.get('minSalary')),
      sort: normalizePublicJobsSort(searchParams.get('sort')),
      includeFacets: searchParams.get('facets') !== '0',
    });

    return jsonOk(result, request);
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
