import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { decodeFeedText } from '../../html';
import { inferCountryCodes, normalizeEmploymentType, normalizeWorkArrangement } from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type ArbeitnowJob = {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
};

type ArbeitnowResponse = {
  data?: ArbeitnowJob[];
  links?: { next?: string | null };
};

export async function fetchArbeitnow(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!takeRateLimitToken('arbeitnow', 10)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();
  let requests = 0;
  let complete = false;

  for (let page = 1; page <= 2; page += 1) {
    requests += 1;
    const response = await fetchProviderJson<ArbeitnowResponse>(
      `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
      { provider: 'arbeitnow', timeoutMs: 12_000, retries: 1, signal: input.signal },
    );
    const pageJobs = Array.isArray(response.data.data) ? response.data.data : [];
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
      const url = (raw.url ?? '').trim();
      const company = (raw.company_name ?? '').trim() || 'Unknown employer';
      const sourceJobId = (raw.slug ?? url).trim();
      if (!title || !url || !sourceJobId || seen.has(sourceJobId)) continue;
      seen.add(sourceJobId);

      const location = raw.location?.trim() || null;
      const workArrangement = normalizeWorkArrangement(undefined, raw.remote);
      jobs.push({
        source: input.source.id,
        sourceJobId,
        title,
        company,
        location,
        countryCodes: inferCountryCodes(location),
        locationRestrictions: [],
        timezoneRestrictions: [],
        remoteType: workArrangement,
        workArrangement,
        employmentType: normalizeEmploymentType(Array.isArray(raw.job_types) ? raw.job_types.join(', ') : null),
        skills: Array.isArray(raw.tags) ? raw.tags.slice(0, 20).map(String) : [],
        description: decodeFeedText(raw.description, 12_000),
        currency: 'EUR',
        salaryPeriod: null,
        publishedAt: raw.created_at ? new Date(raw.created_at * 1000) : null,
        applicationUrl: url,
        canonicalUrl: url,
        attribution: input.source.attribution ?? 'Job data provided by Arbeitnow',
        attributionUrl: input.source.attributionUrl ?? 'https://www.arbeitnow.com',
        attributionRequired: true,
        allowStructuredData: false,
        retentionDays: input.source.retentionDays,
      });
    }

    if (truncated) {
      complete = false;
      break;
    }
    if (!response.data.links?.next) {
      complete = true;
      break;
    }
    complete = false;
  }

  return { jobs, requests, complete, latencyMs: 0 };
}
