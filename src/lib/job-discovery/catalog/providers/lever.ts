import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import { inferCountryCodes, normalizeEmploymentType, normalizeWorkArrangement } from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type LeverPosting = {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  descriptionPlain?: string;
  description?: string;
  categories?: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
    allLocations?: string[];
  };
  workplaceType?: string;
};

export function mapLeverPosting(
  raw: LeverPosting,
  source: ProviderFetchInput['source'],
): NormalizedExternalJob | null {
  const title = (raw.text ?? '').trim();
  const sourceJobId = (raw.id ?? '').trim();
  const hostedUrl = (raw.hostedUrl ?? '').trim();
  const applyUrl = (raw.applyUrl ?? '').trim();
  const applicationUrl = applyUrl || hostedUrl;
  if (!title || !sourceJobId || !applicationUrl) return null;
  const location = raw.categories?.location?.trim() || raw.categories?.allLocations?.join(', ') || null;
  const arrangement = normalizeWorkArrangement(raw.workplaceType || location);
  const countryCodes = [...new Set([
    ...inferCountryCodes(location),
    ...inferCountryCodes(raw.categories?.allLocations?.join(' · ')),
  ])];
  return {
    source: source.id,
    sourceJobId,
    title,
    company: source.employerName ?? source.displayName,
    location,
    countryCodes,
    locationRestrictions: [],
    timezoneRestrictions: [],
    remoteType: arrangement,
    workArrangement: arrangement,
    employmentType: normalizeEmploymentType(raw.categories?.commitment),
    category: raw.categories?.department ?? raw.categories?.team ?? null,
    skills: [],
    description: raw.descriptionPlain?.trim()
      ? raw.descriptionPlain.trim().slice(0, 12_000)
      : htmlToText(raw.description, 12_000),
    publishedAt: raw.createdAt ? new Date(raw.createdAt) : null,
    canonicalUrl: hostedUrl || applicationUrl,
    applicationUrl,
    employerUrl: source.careersUrl,
    attribution: source.attribution ?? source.displayName,
    attributionUrl: source.attributionUrl,
    attributionRequired: source.attributionRequired,
    allowStructuredData: source.allowStructuredData,
    retentionDays: source.retentionDays,
  };
}

export async function fetchLever(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!input.source.boardToken) return { jobs: [], requests: 0, complete: false, notes: ['MISSING_BOARD_TOKEN'] };
  if (!takeRateLimitToken('lever', 20)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }
  const response = await fetchProviderJson<LeverPosting[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(input.source.boardToken)}?mode=json`,
    { provider: 'lever', timeoutMs: 25_000, retries: 1, signal: input.signal },
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  const jobs: NormalizedExternalJob[] = [];
  let truncated = false;
  for (const raw of rows) {
    if (jobs.length >= input.maxJobs) {
      truncated = true;
      break;
    }
    const mapped = mapLeverPosting(raw, input.source);
    if (mapped) jobs.push(mapped);
  }
  return { jobs, requests: 1, complete: !truncated, latencyMs: 0 };
}
