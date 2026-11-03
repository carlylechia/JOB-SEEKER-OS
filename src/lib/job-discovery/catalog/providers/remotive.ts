import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import { inferCountryCodes, normalizeEmploymentType, normalizeWorkArrangement } from '../../location';
import { normalizeJobCategory, normalizeSeniority } from '../../categories';
import { parseSalaryText } from '../../salary';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type RemotiveJob = {
  id?: number | string;
  url?: string;
  title?: string;
  company_name?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
};

type RemotiveResponse = {
  jobs?: RemotiveJob[];
};

const API_URL = 'https://remotive.com/api/remote-jobs';

export function mapRemotiveJob(
  raw: RemotiveJob,
  source: ProviderFetchInput['source'],
): NormalizedExternalJob | null {
  const title = (raw.title ?? '').trim();
  const company = (raw.company_name ?? '').trim() || 'Unknown employer';
  const sourceJobId = String(raw.id ?? '').trim();
  const url = (raw.url ?? '').trim();
  if (!title || !sourceJobId || !url) return null;

  const location = (raw.candidate_required_location ?? '').trim() || 'Remote';
  const salary = parseSalaryText(raw.salary);
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : [];
  const publishedAt = raw.publication_date ? new Date(raw.publication_date) : null;

  return {
    source: source.id,
    sourceJobId,
    title,
    company,
    location,
    countryCodes: inferCountryCodes(location),
    locationRestrictions: [],
    timezoneRestrictions: [],
    remoteType: normalizeWorkArrangement(location, true),
    workArrangement: normalizeWorkArrangement(location, true),
    employmentType: normalizeEmploymentType(raw.job_type),
    seniority: normalizeSeniority(null, title),
    category: normalizeJobCategory(raw.category, title, tags),
    skills: tags.slice(0, 20),
    description: htmlToText(raw.description, 12_000),
    salaryMin: salary.min,
    salaryMax: salary.max,
    currency: salary.currency,
    salaryPeriod: salary.period === 'unknown' ? null : salary.period,
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    expiresAt: null,
    canonicalUrl: url,
    applicationUrl: url,
    employerUrl: null,
    // Remotive's terms require linking back to the supplied URL and visibly
    // crediting Remotive as the source.
    attribution: source.attribution ?? 'Jobs by Remotive',
    attributionUrl: source.attributionUrl ?? 'https://remotive.com',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: source.retentionDays,
  };
}

export async function fetchRemotive(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!takeRateLimitToken('remotive', 4)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const response = await fetchProviderJson<RemotiveResponse>(API_URL, {
    provider: 'remotive',
    timeoutMs: 20_000,
    retries: 1,
    signal: input.signal,
  });

  const rows = Array.isArray(response.data.jobs) ? response.data.jobs : [];
  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();

  for (const raw of rows) {
    if (jobs.length >= input.maxJobs) break;
    const mapped = mapRemotiveJob(raw, input.source);
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
