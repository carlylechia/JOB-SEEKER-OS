import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import { inferCountryCodes, normalizeWorkArrangement } from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type GreenhouseJob = {
  id?: number | string;
  title?: string;
  absolute_url?: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  content?: string;
  metadata?: Array<{ name?: string; value?: string | string[] | null }>;
};

type GreenhouseResponse = { jobs?: GreenhouseJob[] };

function metadataValue(job: GreenhouseJob, names: string[]) {
  const wanted = names.map((name) => name.toLowerCase());
  for (const entry of job.metadata ?? []) {
    if (entry.name && wanted.includes(entry.name.toLowerCase())) {
      if (Array.isArray(entry.value)) return entry.value.join(', ');
      if (typeof entry.value === 'string') return entry.value;
    }
  }
  return null;
}

export function mapGreenhouseJob(
  raw: GreenhouseJob,
  source: ProviderFetchInput['source'],
): NormalizedExternalJob | null {
  const title = (raw.title ?? '').trim();
  const sourceJobId = String(raw.id ?? '').trim();
  const applicationUrl = (raw.absolute_url ?? '').trim();
  if (!title || !sourceJobId || !applicationUrl) return null;
  const location = raw.location?.name?.trim() || null;
  const arrangement = normalizeWorkArrangement(location);
  return {
    source: source.id,
    sourceJobId,
    title,
    company: source.employerName ?? source.displayName,
    location,
    countryCodes: inferCountryCodes(location),
    locationRestrictions: [],
    timezoneRestrictions: [],
    remoteType: arrangement,
    workArrangement: arrangement,
    employmentType: null,
    category: metadataValue(raw, ['Department', 'Team']),
    skills: [],
    description: htmlToText(raw.content, 12_000),
    publishedAt: raw.first_published ? new Date(raw.first_published) : raw.updated_at ? new Date(raw.updated_at) : null,
    canonicalUrl: applicationUrl,
    applicationUrl,
    employerUrl: source.careersUrl,
    attribution: source.attribution ?? source.displayName,
    attributionUrl: source.attributionUrl,
    attributionRequired: source.attributionRequired,
    allowStructuredData: source.allowStructuredData,
    retentionDays: source.retentionDays,
  };
}

export async function fetchGreenhouse(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!input.source.boardToken) return { jobs: [], requests: 0, complete: false, notes: ['MISSING_BOARD_TOKEN'] };
  if (!takeRateLimitToken('greenhouse', 60)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }
  const full = input.source.descriptionMode !== 'metadata';
  const params = new URLSearchParams({ content: String(full) });
  const response = await fetchProviderJson<GreenhouseResponse>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(input.source.boardToken)}/jobs?${params.toString()}`,
    { provider: 'greenhouse', timeoutMs: full ? 25_000 : 12_000, retries: 1, signal: input.signal },
  );
  const rows = Array.isArray(response.data.jobs) ? response.data.jobs : [];
  const jobs: NormalizedExternalJob[] = [];
  let truncated = false;
  for (const raw of rows) {
    if (jobs.length >= input.maxJobs) {
      truncated = true;
      break;
    }
    const mapped = mapGreenhouseJob(raw, input.source);
    if (mapped) jobs.push(mapped);
  }
  return { jobs, requests: 1, complete: !truncated, latencyMs: 0 };
}
