import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import { inferCountryCodes, normalizeEmploymentType, normalizeWorkArrangement } from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type JobicyJob = {
  id?: number | string;
  url?: string;
  jobSlug?: string;
  jobTitle?: string;
  companyName?: string;
  jobIndustry?: string[];
  jobType?: string[];
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number | string | null;
  salaryMax?: number | string | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
};

type JobicyResponse = {
  jobs?: JobicyJob[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

const API_URL = 'https://jobicy.com/api/v2/remote-jobs';
const MAX_PAGE_SIZE = 100;
const MAX_PAGES = 3;

function positiveNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function mapJobicyJob(
  raw: JobicyJob,
  source: ProviderFetchInput['source'],
): NormalizedExternalJob | null {
  const title = (raw.jobTitle ?? '').trim();
  const company = (raw.companyName ?? '').trim() || 'Unknown employer';
  const sourceJobId = String(raw.id ?? raw.jobSlug ?? '').trim();
  const url = (raw.url ?? '').trim();
  if (!title || !sourceJobId || !url) return null;

  const location = raw.jobGeo?.trim() || 'Remote';
  const remote = normalizeWorkArrangement(location, true);
  const description =
    htmlToText(raw.jobDescription, 12_000) ??
    htmlToText(raw.jobExcerpt, 2_000) ??
    null;
  const jobTypes = Array.isArray(raw.jobType) ? raw.jobType.filter(Boolean).join(', ') : null;
  const industries = Array.isArray(raw.jobIndustry) ? raw.jobIndustry.filter(Boolean) : [];

  return {
    source: source.id,
    sourceJobId,
    title,
    company,
    location,
    countryCodes: inferCountryCodes(location),
    locationRestrictions: [],
    timezoneRestrictions: [],
    remoteType: remote,
    workArrangement: remote,
    employmentType: normalizeEmploymentType(jobTypes),
    seniority: raw.jobLevel && !/^any$/i.test(raw.jobLevel.trim()) ? raw.jobLevel.trim() : null,
    industry: industries[0] ?? null,
    category: industries.join(', ') || null,
    skills: [],
    description,
    salaryMin: positiveNumber(raw.salaryMin),
    salaryMax: positiveNumber(raw.salaryMax),
    currency: raw.salaryCurrency?.trim().toUpperCase() || 'USD',
    salaryPeriod: raw.salaryPeriod?.trim().toLowerCase() || null,
    publishedAt: parseDate(raw.pubDate),
    expiresAt: null,
    canonicalUrl: url,
    applicationUrl: url,
    employerUrl: null,
    attribution: source.attribution ?? 'Jobs by Jobicy',
    attributionUrl: source.attributionUrl ?? 'https://jobicy.com',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: source.retentionDays,
  };
}

/**
 * Jobicy's public API exposes paginated remote listings through an opaque
 * cursor. The free feed intentionally returns Jobicy listing URLs, not direct
 * employer ATS URLs; the listing page is therefore both the canonical and the
 * application URL. Attribution is required by the provider's terms.
 */
export async function fetchJobicy(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!takeRateLimitToken('jobicy', 12)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.maxJobs));
  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();
  let requests = 0;
  let cursor: string | null = null;
  let complete = false;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ count: String(pageSize) });
    if (cursor) params.set('cursor', cursor);
    requests += 1;

    const response = await fetchProviderJson<JobicyResponse>(`${API_URL}?${params.toString()}`, {
      provider: 'jobicy',
      timeoutMs: 15_000,
      retries: 1,
      signal: input.signal,
    });

    const rows = Array.isArray(response.data.jobs) ? response.data.jobs : [];
    if (rows.length === 0) {
      complete = true;
      break;
    }

    for (const raw of rows) {
      if (jobs.length >= input.maxJobs) {
        truncated = true;
        break;
      }
      const mapped = mapJobicyJob(raw, input.source);
      if (!mapped || seen.has(mapped.sourceJobId)) continue;
      seen.add(mapped.sourceJobId);
      jobs.push(mapped);
    }

    if (truncated) break;

    const nextCursor = response.data.nextCursor?.trim();
    if (!response.data.hasMore || !nextCursor) {
      complete = true;
      break;
    }
    cursor = nextCursor;
  }

  return {
    jobs,
    requests,
    complete,
    latencyMs: 0,
    notes: complete ? [] : ['PARTIAL_CURSOR'],
  };
}
