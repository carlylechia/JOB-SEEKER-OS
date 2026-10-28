import { fetchProviderJson, parseNumberHeader, takeRateLimitToken } from '../../http';
import { truncateText } from '../../html';
import { inferCountryCodes, normalizeWorkArrangement } from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

export function isHeadcountLabsConfigured() {
  return Boolean(
    process.env.HEADCOUNTLABS_API_KEY?.trim() &&
      process.env.HEADCOUNTLABS_LICENSE_ACK === 'true',
  );
}

type FieldState<T> = { state?: string; value?: T | null };

type HeadcountLocation = FieldState<{ city?: string; region?: string; country?: string }>;

type HeadcountPosting = {
  posting_id?: string;
  source?: string;
  source_posting_id?: string;
  posting_status?: string;
  posting_url?: FieldState<string>;
  application_url?: FieldState<string>;
  location?: FieldState<{ city?: string; state?: string; country?: string; remote?: boolean }>;
  pay?: FieldState<{ min?: number; max?: number; currency?: string; interval?: string }>;
  source_posted_at?: string;
  attribution?: { required?: boolean | null; text?: string | null; link?: string | null };
};

type HeadcountJob = {
  job_id?: string;
  currentness?: string;
  stale?: boolean;
  employer_name?: FieldState<string>;
  title?: FieldState<string>;
  description?: FieldState<string>;
  work_arrangement?: FieldState<string>;
  locations?: HeadcountLocation[];
  job_first_seen_at?: string;
  job_updated_at?: string;
  postings?: HeadcountPosting[];
};

type HeadcountResponse = { data?: HeadcountJob[]; next_cursor?: string | null };

function valueOf<T>(field: FieldState<T> | undefined): T | null {
  return field?.state === 'known' && field.value !== undefined ? field.value : null;
}

export async function fetchHeadcountLabs(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  const key = process.env.HEADCOUNTLABS_API_KEY?.trim();
  if (!key || process.env.HEADCOUNTLABS_LICENSE_ACK !== 'true') {
    return { jobs: [], requests: 0, complete: false, notes: ['NOT_CONFIGURED'] };
  }
  if (!takeRateLimitToken('headcountlabs', 10)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const limit = Math.max(10, Math.min(100, input.maxJobs));
  const response = await fetchProviderJson<HeadcountResponse>(
    `https://api.headcountlabs.com/v1/jobs?currentness=current&limit=${limit}`,
    {
      provider: 'headcountlabs',
      timeoutMs: 25_000,
      retries: 1,
      signal: input.signal,
      headers: { Authorization: `Bearer ${key}` },
    },
  );

  const rows = Array.isArray(response.data.data) ? response.data.data : [];
  const jobs: NormalizedExternalJob[] = [];
  let truncated = false;
  for (const raw of rows) {
    if (jobs.length >= input.maxJobs) {
      truncated = true;
      break;
    }
    const title = (valueOf(raw.title) ?? '').trim();
    const company = (valueOf(raw.employer_name) ?? '').trim();
    const sourceJobId = (raw.job_id ?? '').trim();
    if (!title || !company || !sourceJobId) continue;
    const posting = (raw.postings ?? []).find((item) => item.posting_status !== 'no_longer_listed') ?? raw.postings?.[0];
    if (!posting) continue;
    const applicationUrl = (valueOf(posting.application_url) ?? valueOf(posting.posting_url) ?? '').trim();
    if (!applicationUrl) continue;

    const locations = (raw.locations ?? [])
      .map((entry) => valueOf(entry))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const countryCodes = [...new Set(locations.map((entry) => entry.country).filter(Boolean).map(String))];
    const location = locations
      .map((entry) => [entry.city, entry.region, entry.country].filter(Boolean).join(', '))
      .filter(Boolean)
      .join(' · ') || null;
    const pay = valueOf(posting.pay);
    const arrangement = normalizeWorkArrangement(valueOf(raw.work_arrangement));
    const attributionRequired = Boolean(posting.attribution?.required);
    const attributionText = attributionRequired
      ? posting.attribution?.text?.trim() || 'Job data: Headcount Labs'
      : 'Job data: Headcount Labs';
    const attributionUrl = attributionRequired
      ? posting.attribution?.link?.trim() || 'https://headcountlabs.com'
      : 'https://headcountlabs.com';

    jobs.push({
      source: input.source.id,
      sourceJobId,
      title,
      company,
      location,
      countryCodes: countryCodes.length > 0 ? countryCodes : inferCountryCodes(location),
      locationRestrictions: countryCodes,
      timezoneRestrictions: [],
      remoteType: arrangement,
      workArrangement: arrangement,
      employmentType: null,
      category: null,
      description: truncateText(valueOf(raw.description), 12_000),
      salaryMin: typeof pay?.min === 'number' ? pay.min : null,
      salaryMax: typeof pay?.max === 'number' ? pay.max : null,
      currency: pay?.currency ?? 'USD',
      salaryPeriod: pay?.interval ?? null,
      publishedAt: posting.source_posted_at
        ? new Date(posting.source_posted_at)
        : raw.job_first_seen_at
          ? new Date(raw.job_first_seen_at)
          : null,
      canonicalUrl: valueOf(posting.posting_url),
      applicationUrl,
      employerUrl: input.source.careersUrl,
      attribution: attributionText,
      attributionUrl,
      attributionRequired: true,
      allowStructuredData: false,
      retentionDays: null,
    });
  }

  const recordsRemaining = parseNumberHeader(response.headers, 'x-data-records-remaining');
  return {
    jobs,
    requests: 1,
    complete: !response.data.next_cursor && !truncated,
    rateLimitRemaining: recordsRemaining,
    quotaExhausted: recordsRemaining === 0,
    latencyMs: 0,
    notes: recordsRemaining !== null ? [`records_remaining:${recordsRemaining}`] : undefined,
  };
}
