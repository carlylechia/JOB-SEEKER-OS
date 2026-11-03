import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import { inferCountryCodes, normalizeWorkArrangement } from '../../location';
import { normalizeJobCategory, normalizeSeniority } from '../../categories';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type WorkingNomadsJob = {
  url?: string;
  title?: string;
  description?: string;
  company_name?: string;
  category_name?: string;
  tags?: string;
  location?: string;
  pub_date?: string;
};

const API_URL = 'https://www.workingnomads.com/api/exposed_jobs/';

function parseTags(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

export function mapWorkingNomadsJob(
  raw: WorkingNomadsJob,
  source: ProviderFetchInput['source'],
): NormalizedExternalJob | null {
  const title = (raw.title ?? '').trim();
  const company = (raw.company_name ?? '').trim() || 'Unknown employer';
  const url = (raw.url ?? '').trim();
  if (!title || !url) return null;

  const location = (raw.location ?? '').trim() || 'Remote';
  const tags = parseTags(raw.tags);
  const publishedAt = raw.pub_date ? new Date(raw.pub_date) : null;
  const remote = normalizeWorkArrangement(location, true);

  return {
    source: source.id,
    sourceJobId: url,
    title,
    company,
    location,
    countryCodes: inferCountryCodes(location),
    locationRestrictions: [],
    timezoneRestrictions: [],
    remoteType: remote,
    workArrangement: remote,
    employmentType: null,
    seniority: normalizeSeniority(null, title),
    category: normalizeJobCategory(raw.category_name, title, tags),
    skills: tags,
    description: htmlToText(raw.description, 12_000),
    salaryMin: null,
    salaryMax: null,
    currency: 'USD',
    salaryPeriod: null,
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    expiresAt: null,
    canonicalUrl: url,
    applicationUrl: url,
    employerUrl: null,
    attribution: source.attribution ?? 'Jobs by Working Nomads',
    attributionUrl: source.attributionUrl ?? 'https://www.workingnomads.com',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: source.retentionDays,
  };
}

export async function fetchWorkingNomads(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!takeRateLimitToken('workingnomads', 4)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const response = await fetchProviderJson<WorkingNomadsJob[]>(API_URL, {
    provider: 'workingnomads',
    timeoutMs: 20_000,
    retries: 1,
    signal: input.signal,
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();

  for (const raw of rows) {
    if (jobs.length >= input.maxJobs) break;
    const mapped = mapWorkingNomadsJob(raw, input.source);
    if (!mapped || seen.has(mapped.sourceJobId)) continue;
    seen.add(mapped.sourceJobId);
    jobs.push(mapped);
  }

  return {
    jobs,
    requests: 1,
    complete: rows.length <= input.maxJobs,
    latencyMs: 0,
  };
}
