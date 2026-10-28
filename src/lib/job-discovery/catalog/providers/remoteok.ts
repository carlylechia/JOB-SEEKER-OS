import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import { inferCountryCodes, normalizeEmploymentType, normalizeWorkArrangement } from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type RemoteOkJob = {
  id?: string;
  slug?: string;
  company?: string;
  position?: string;
  location?: string;
  tags?: string[];
  date?: string;
  epoch?: number;
  salary_min?: number;
  salary_max?: number;
  apply_url?: string;
  url?: string;
  description?: string;
  legal?: string;
};

export async function fetchRemoteOk(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!takeRateLimitToken('remoteok', 4)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const response = await fetchProviderJson<RemoteOkJob[]>(
    'https://remoteok.com/api',
    { provider: 'remoteok', timeoutMs: 15_000, retries: 1, signal: input.signal },
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();

  let truncated = false;
  for (const raw of rows) {
    if (jobs.length >= input.maxJobs) {
      truncated = true;
      break;
    }
    // The first element is Remote OK's API terms banner, not a job.
    if (!raw?.id || !raw?.position) continue;
    if (seen.has(String(raw.id))) continue;
    seen.add(String(raw.id));

    const title = raw.position.trim();
    const company = (raw.company ?? '').trim() || 'Unknown employer';
    const url = (raw.apply_url || raw.url || '').trim();
    if (!url) continue;
    const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
    const description = htmlToText(raw.description, 12_000);
    const location = raw.location?.trim() || 'Remote';
    const remote = normalizeWorkArrangement(location, true);

    jobs.push({
      source: input.source.id,
      sourceJobId: String(raw.id),
      title,
      company,
      location,
      countryCodes: inferCountryCodes(location),
      locationRestrictions: [],
      timezoneRestrictions: [],
      remoteType: remote,
      workArrangement: remote,
      employmentType: /\bcontract\b/i.test(tags.join(' ')) ? 'CONTRACT' : 'FULL_TIME',
      skills: tags.slice(0, 20),
      description,
      salaryMin: Number.isFinite(raw.salary_min) && raw.salary_min! > 0 ? raw.salary_min : null,
      salaryMax: Number.isFinite(raw.salary_max) && raw.salary_max! > 0 ? raw.salary_max : null,
      currency: 'USD',
      salaryPeriod: 'annual',
      publishedAt: raw.date ? new Date(raw.date) : raw.epoch ? new Date(raw.epoch * 1000) : null,
      canonicalUrl: raw.url || url,
      applicationUrl: url,
      attribution: input.source.attribution ?? 'Remote OK',
      attributionUrl: input.source.attributionUrl ?? 'https://remoteok.com',
      attributionRequired: true,
      allowStructuredData: false,
      retentionDays: input.source.retentionDays,
    });
  }

  return { jobs, requests: 1, complete: !truncated, latencyMs: 0 };
}
