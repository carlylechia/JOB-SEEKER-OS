import { fetchProviderJson, parseNumberHeader, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import {
  inferCountryCodes,
  normalizeCountryList,
  normalizeEmploymentType,
} from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type HimalayasJob = {
  guid?: string;
  title?: string;
  companyName?: string;
  companySlug?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string | null;
  seniority?: string[];
  currency?: string | null;
  locationRestrictions?: string[];
  timezoneRestrictions?: number[];
  categories?: string[];
  parentCategories?: string[];
  description?: string;
  pubDate?: number;
  expiryDate?: number;
  applicationLink?: string;
};

type HimalayasResponse = {
  jobs?: HimalayasJob[];
  nextCursor?: string | null;
  totalCount?: number;
};

const MAX_PAGES = 5;

export async function fetchHimalayas(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!takeRateLimitToken('himalayas', 50)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const key = process.env.HIMALAYAS_API_KEY?.trim();
  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let requests = 0;
  let rateLimitRemaining: number | null = null;
  let complete = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: '20' });
    if (cursor) params.set('cursor', cursor);
    requests += 1;
    const response = await fetchProviderJson<HimalayasResponse>(
      `https://himalayas.app/jobs/api?${params.toString()}`,
      {
        provider: 'himalayas',
        timeoutMs: 15_000,
        retries: 1,
        signal: input.signal,
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      },
    );
    rateLimitRemaining = parseNumberHeader(response.headers, 'x-ratelimit-remaining') ?? rateLimitRemaining;

    const pageJobs = Array.isArray(response.data.jobs) ? response.data.jobs : [];
    if (pageJobs.length === 0) {
      complete = true;
      break;
    }

    let truncated = false;
    for (const raw of pageJobs) {
      if (jobs.length >= input.maxJobs) {
        truncated = true;
        break;
      }
      const title = (raw.title ?? '').trim();
      const company = (raw.companyName ?? '').trim();
      const guid = (raw.guid ?? '').trim();
      const applicationUrl = (raw.applicationLink ?? '').trim();
      const expiry = raw.expiryDate ? new Date(raw.expiryDate * 1000) : null;
      if (!title || !company || !guid || !applicationUrl) continue;
      if (expiry && expiry.getTime() < Date.now()) continue;
      if (seen.has(guid)) continue;
      seen.add(guid);

      const locationRestrictions = normalizeCountryList(raw.locationRestrictions ?? []);
      const location = (raw.locationRestrictions ?? []).filter(Boolean).join(', ') || 'Remote';
      jobs.push({
        source: input.source.id,
        sourceJobId: guid,
        title,
        company,
        location,
        countryCodes: locationRestrictions.length > 0 ? locationRestrictions : inferCountryCodes(location),
        locationRestrictions,
        timezoneRestrictions: Array.isArray(raw.timezoneRestrictions) ? raw.timezoneRestrictions.filter(Number.isFinite) : [],
        remoteType: 'Remote',
        workArrangement: 'Remote',
        employmentType: normalizeEmploymentType(raw.employmentType),
        seniority: Array.isArray(raw.seniority) ? raw.seniority.join(', ') : null,
        category: raw.parentCategories?.[0] ?? raw.categories?.[0] ?? null,
        skills: Array.isArray(raw.categories) ? raw.categories.slice(0, 20) : [],
        description: htmlToText(raw.description, 12_000),
        salaryMin: typeof raw.minSalary === 'number' ? raw.minSalary : null,
        salaryMax: typeof raw.maxSalary === 'number' ? raw.maxSalary : null,
        currency: raw.currency ?? null,
        salaryPeriod: raw.salaryPeriod ?? null,
        publishedAt: raw.pubDate ? new Date(raw.pubDate * 1000) : null,
        expiresAt: expiry,
        canonicalUrl: guid,
        // Himalayas API terms require this exact link, unmodified.
        applicationUrl,
        employerUrl: raw.companySlug ? `https://himalayas.app/companies/${encodeURIComponent(raw.companySlug)}` : null,
        attribution: input.source.attribution ?? 'Jobs by Himalayas',
        attributionUrl: input.source.attributionUrl ?? 'https://himalayas.app',
        attributionRequired: true,
        // API terms forbid onward syndication and JobPosting structured data.
        allowStructuredData: false,
        retentionDays: null,
      });
    }

    cursor = response.data.nextCursor ?? null;
    if (truncated || jobs.length >= input.maxJobs) {
      complete = !cursor && !truncated;
      break;
    }
    if (!cursor) {
      complete = true;
      break;
    }
  }

  return { jobs, requests, complete, rateLimitRemaining, latencyMs: 0 };
}
