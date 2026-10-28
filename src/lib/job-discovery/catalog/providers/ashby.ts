import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import { inferCountryCodes, normalizeEmploymentType, normalizeWorkArrangement } from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type AshbyAddress = {
  postalAddress?: {
    addressCountry?: string;
    addressRegion?: string;
    addressLocality?: string;
  };
};

type AshbyJob = {
  id?: string;
  title?: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string; address?: AshbyAddress }>;
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  address?: AshbyAddress;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
};

type AshbyResponse = { jobs?: AshbyJob[] };

function addressText(address?: AshbyAddress) {
  const value = address?.postalAddress;
  if (!value) return '';
  return [value.addressLocality, value.addressRegion, value.addressCountry].filter(Boolean).join(', ');
}

function countryCodesFor(raw: AshbyJob) {
  const values = [
    raw.location,
    addressText(raw.address),
    ...(raw.secondaryLocations ?? []).flatMap((entry) => [entry.location, addressText(entry.address)]),
  ];
  return [...new Set(inferCountryCodes(...values))];
}

export function mapAshbyJob(raw: AshbyJob, source: ProviderFetchInput['source']): NormalizedExternalJob | null {
  const title = (raw.title ?? '').trim();
  const sourceJobId = (raw.id ?? '').trim();
  const applicationUrl = (raw.applyUrl || raw.jobUrl || '').trim();
  if (!title || !sourceJobId || !applicationUrl || raw.isListed === false) return null;
  const location = raw.location?.trim() || null;
  const arrangement = normalizeWorkArrangement(raw.workplaceType, raw.isRemote);
  const description = raw.descriptionPlain?.trim()
    ? raw.descriptionPlain.trim().slice(0, 12_000)
    : htmlToText(raw.descriptionHtml, 12_000);

  return {
    source: source.id,
    sourceJobId,
    title,
    company: source.employerName ?? source.displayName,
    location,
    countryCodes: countryCodesFor(raw),
    locationRestrictions: [],
    timezoneRestrictions: [],
    remoteType: arrangement,
    workArrangement: arrangement,
    employmentType: normalizeEmploymentType(raw.employmentType),
    category: raw.department ?? raw.team ?? null,
    skills: [],
    description,
    publishedAt: raw.publishedAt ? new Date(raw.publishedAt) : null,
    canonicalUrl: raw.jobUrl || applicationUrl,
    applicationUrl,
    employerUrl: source.careersUrl,
    attribution: source.attribution ?? source.displayName,
    attributionUrl: source.attributionUrl,
    attributionRequired: source.attributionRequired,
    allowStructuredData: source.allowStructuredData,
    retentionDays: source.retentionDays,
  };
}

export async function fetchAshby(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!input.source.boardToken) return { jobs: [], requests: 0, complete: false, notes: ['MISSING_BOARD_TOKEN'] };
  if (!takeRateLimitToken('ashby', 20)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }
  const response = await fetchProviderJson<AshbyResponse>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(input.source.boardToken)}`,
    { provider: 'ashby', timeoutMs: 25_000, retries: 1, signal: input.signal },
  );
  const rows = Array.isArray(response.data.jobs) ? response.data.jobs : [];
  const jobs: NormalizedExternalJob[] = [];
  let truncated = false;
  for (const raw of rows) {
    if (jobs.length >= input.maxJobs) {
      truncated = true;
      break;
    }
    const mapped = mapAshbyJob(raw, input.source);
    if (mapped) jobs.push(mapped);
  }
  return { jobs, requests: 1, complete: !truncated, latencyMs: 0 };
}
