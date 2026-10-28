import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { truncateText } from '../../html';
import { inferCountryCodes, normalizeEmploymentType } from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

export function isUsaJobsConfigured() {
  return Boolean(process.env.USAJOBS_API_KEY?.trim() && process.env.USAJOBS_USER_AGENT?.trim());
}

type UsaJobsDescriptor = {
  PositionID?: string;
  PositionTitle?: string;
  PositionURI?: string;
  ApplyURI?: string[];
  PositionLocationDisplay?: string;
  PositionLocation?: Array<{ CountryCode?: string; CityName?: string }>;
  OrganizationName?: string;
  DepartmentName?: string;
  JobCategory?: Array<{ Name?: string }>;
  PositionSchedule?: Array<{ Name?: string }>;
  PositionOfferingType?: Array<{ Name?: string }>;
  QualificationSummary?: string;
  PositionRemuneration?: Array<{ MinimumRange?: string; MaximumRange?: string; RateIntervalCode?: string }>;
  PublicationStartDate?: string;
  ApplicationCloseDate?: string;
  UserArea?: {
    Details?: {
      JobSummary?: string;
      MajorDuties?: string;
      Requirements?: string;
      WhoMayApply?: { Name?: string };
    };
  };
};

type UsaJobsResponse = {
  SearchResult?: {
    SearchResultItems?: Array<{ MatchedObjectId?: string; MatchedObjectDescriptor?: UsaJobsDescriptor }>;
  };
};

export function mapUsaJobsItem(raw: { MatchedObjectId?: string; MatchedObjectDescriptor?: UsaJobsDescriptor }): NormalizedExternalJob | null {
  const item = raw.MatchedObjectDescriptor;
  if (!item) return null;
  const title = (item.PositionTitle ?? '').trim();
  const company = (item.OrganizationName ?? item.DepartmentName ?? '').trim();
  const sourceJobId = (item.PositionID ?? raw.MatchedObjectId ?? '').trim();
  if (!title || !company || !sourceJobId) return null;

  const applyUrl = Array.isArray(item.ApplyURI) ? item.ApplyURI.find(Boolean) : null;
  const applicationUrl = (applyUrl || item.PositionURI || '').trim();
  if (!applicationUrl) return null;

  const location = (item.PositionLocationDisplay ?? '').trim() || null;
  const details = item.UserArea?.Details;
  const description = truncateText(
    [details?.JobSummary, details?.MajorDuties, item.QualificationSummary, details?.Requirements]
      .filter(Boolean)
      .join('\n\n'),
    12_000,
  );
  const pay = item.PositionRemuneration?.[0];
  const min = pay?.MinimumRange ? Number(pay.MinimumRange) : null;
  const max = pay?.MaximumRange ? Number(pay.MaximumRange) : null;
  const annual = pay?.RateIntervalCode === 'PA' || pay?.RateIntervalCode === 'Per Year';
  const countryCodes = (item.PositionLocation ?? [])
    .map((entry) => entry.CountryCode)
    .filter(Boolean)
    .map(String)
    .flatMap((value) => (value === 'United States' ? ['US'] : inferCountryCodes(value)));
  if (countryCodes.length === 0) countryCodes.push('US');

  return {
    source: 'usajobs',
    sourceJobId,
    title,
    company,
    location,
    countryCodes: [...new Set(countryCodes)],
    locationRestrictions: ['US'],
    timezoneRestrictions: [],
    remoteType: /remote/i.test(location ?? '') ? 'Remote' : null,
    workArrangement: /remote/i.test(location ?? '') ? 'Remote' : null,
    employmentType: normalizeEmploymentType(item.PositionSchedule?.map((entry) => entry.Name).filter(Boolean).join(', ')) ?? 'FULL_TIME',
    category: item.JobCategory?.[0]?.Name ?? null,
    seniority: null,
    description,
    salaryMin: Number.isFinite(min) ? min : null,
    salaryMax: Number.isFinite(max) ? max : null,
    currency: 'USD',
    salaryPeriod: annual ? 'annual' : null,
    publishedAt: item.PublicationStartDate ? new Date(item.PublicationStartDate) : null,
    expiresAt: item.ApplicationCloseDate ? new Date(item.ApplicationCloseDate) : null,
    canonicalUrl: item.PositionURI ?? applicationUrl,
    applicationUrl,
    attribution: 'USAJOBS',
    attributionUrl: 'https://www.usajobs.gov',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: null,
  };
}

export async function fetchUsaJobs(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  const key = process.env.USAJOBS_API_KEY?.trim();
  const userAgent = process.env.USAJOBS_USER_AGENT?.trim();
  if (!key || !userAgent) {
    return { jobs: [], requests: 0, complete: false, notes: ['NOT_CONFIGURED'] };
  }
  if (!takeRateLimitToken('usajobs', 10)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();
  let requests = 0;
  let rateLimitRemaining: number | null = null;
  let complete = false;

  for (let page = 1; page <= 2; page += 1) {
    requests += 1;
    const params = new URLSearchParams({
      ResultsPerPage: '50',
      Page: String(page),
      Fields: 'Full',
      WhoMayApply: 'public',
      DatePosted: '30',
      SortField: 'opendate',
      SortDirection: 'Desc',
    });
    const response = await fetchProviderJson<UsaJobsResponse>(
      `https://data.usajobs.gov/api/search?${params.toString()}`,
      {
        provider: 'usajobs',
        timeoutMs: 20_000,
        retries: 1,
        signal: input.signal,
        headers: {
          Host: 'data.usajobs.gov',
          'User-Agent': userAgent,
          'Authorization-Key': key,
        },
      },
    );
    rateLimitRemaining = Number(response.headers.get('x-ratelimit-remaining') ?? rateLimitRemaining);
    const rows = response.data.SearchResult?.SearchResultItems ?? [];
    if (rows.length === 0) {
      complete = true;
      break;
    }
    let truncated = false;
    for (const raw of rows) {
      if (jobs.length >= input.maxJobs) {
        truncated = true;
        break;
      }
      const mapped = mapUsaJobsItem(raw);
      if (!mapped) continue;
      if (seen.has(mapped.sourceJobId)) continue;
      seen.add(mapped.sourceJobId);
      jobs.push({ ...mapped, source: input.source.id });
    }
    if (truncated) {
      complete = false;
      break;
    }
    if (rows.length < 50) {
      complete = true;
      break;
    }
    complete = false;
  }

  return { jobs, requests, complete, rateLimitRemaining, latencyMs: 0 };
}
