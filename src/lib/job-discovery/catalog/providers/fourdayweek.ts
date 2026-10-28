import { fetchProviderJson, takeRateLimitToken } from '../../http';
import { normalizeCountryList, normalizeEmploymentType, normalizeWorkArrangement } from '../../location';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

type FourDayWeekLocation = {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  work_arrangement?: string | null;
};

type FourDayWeekJob = {
  id?: string;
  title?: string;
  slug?: string;
  company_name?: string;
  work_arrangement?: string;
  locations?: FourDayWeekLocation[];
  posted?: number;
  schedule_type?: string;
  category?: string;
  level?: string;
  is_expired?: boolean;
  locked?: boolean;
  salary?: string;
  salary_lower?: number;
  salary_upper?: number;
  salary_currency?: string;
  salary_period?: string;
};

type FourDayWeekResponse = {
  jobs?: FourDayWeekJob[];
  total?: number;
  page?: number;
  has_more?: boolean;
};

function pageStart() {
  const parsed = Number(process.env.FOURDAYWEEK_START_PAGE ?? '24');
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(200, Math.round(parsed)));
}

export async function fetchFourDayWeek(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!takeRateLimitToken('fourdayweek', 50)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();
  let requests = 0;
  const start = pageStart();

  for (let offset = 0; offset < 6; offset += 1) {
    requests += 1;
    const page = start + offset;
    const response = await fetchProviderJson<FourDayWeekResponse>(
      `https://4dayweek.io/api/jobs?page=${page}&limit=25`,
      { provider: 'fourdayweek', timeoutMs: 15_000, retries: 1, signal: input.signal },
    );
    const rows = Array.isArray(response.data.jobs) ? response.data.jobs : [];
    if (rows.length === 0) break;

    for (const raw of rows) {
      if (jobs.length >= input.maxJobs) break;
      // The free feed hides the newest listings until they leave early access.
      // Locked records have no employer or public URL, so they are not useful.
      if (raw.locked || raw.is_expired) continue;
      const title = (raw.title ?? '').trim();
      const company = (raw.company_name ?? '').trim();
      const slug = (raw.slug ?? '').trim();
      const id = (raw.id ?? '').trim();
      if (!title || !company || !slug || !id || seen.has(id)) continue;
      seen.add(id);

      const locations = Array.isArray(raw.locations) ? raw.locations : [];
      const primary = locations.find((location) => location.city) ?? locations[0];
      const location = [primary?.city, primary?.state, primary?.country].filter(Boolean).join(', ') || null;
      const workArrangement = normalizeWorkArrangement(raw.work_arrangement);
      const lower = typeof raw.salary_lower === 'number' ? Math.round(raw.salary_lower / 100) : null;
      const upper = typeof raw.salary_upper === 'number' ? Math.round(raw.salary_upper / 100) : null;
      const countryCodes = normalizeCountryList(
        [...new Set(locations.map((item) => item.country).filter(Boolean).map(String))],
      );

      jobs.push({
        source: input.source.id,
        sourceJobId: id,
        title,
        company,
        location,
        countryCodes,
        locationRestrictions: countryCodes,
        timezoneRestrictions: [],
        remoteType: workArrangement,
        workArrangement,
        employmentType: normalizeEmploymentType(raw.schedule_type),
        seniority: raw.level ?? null,
        category: raw.category ?? null,
        description: null,
        salaryMin: lower,
        salaryMax: upper,
        currency: raw.salary_currency ?? null,
        salaryPeriod: raw.salary_period ?? null,
        publishedAt: raw.posted ? new Date(raw.posted * 1000) : null,
        canonicalUrl: `https://4dayweek.io/job/${encodeURIComponent(slug)}`,
        applicationUrl: `https://4dayweek.io/job/${encodeURIComponent(slug)}`,
        attribution: input.source.attribution ?? 'Listed on 4 Day Week',
        attributionUrl: input.source.attributionUrl ?? 'https://4dayweek.io',
        attributionRequired: true,
        allowStructuredData: false,
        retentionDays: input.source.retentionDays,
      });
    }

    if (!response.data.has_more) break;
  }

  return { jobs, requests, complete: false, latencyMs: 0 };
}
