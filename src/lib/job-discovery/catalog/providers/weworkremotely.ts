import { fetchProviderText, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import { inferCountryCodes, normalizeWorkArrangement } from '../../location';
import { normalizeJobCategory, normalizeSeniority } from '../../categories';
import { parseRssDate, parseRssItems, splitCompanyFromTitle } from '../../rss';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

const FEEDS = [
  { url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss', category: 'Programming' },
  { url: 'https://weworkremotely.com/categories/remote-design-jobs.rss', category: 'Design' },
  { url: 'https://weworkremotely.com/categories/remote-product-jobs.rss', category: 'Product' },
  { url: 'https://weworkremotely.com/categories/remote-customer-support-jobs.rss', category: 'Customer Support' },
] as const;

export function mapWeWorkRemotelyItem(
  raw: ReturnType<typeof parseRssItems>[number],
  source: ProviderFetchInput['source'],
  feedCategory: string,
): NormalizedExternalJob | null {
  const split = splitCompanyFromTitle(raw.title);
  const company = split.company || 'Unknown employer';
  const title = split.title.trim();
  const url = (raw.link || raw.guid).trim();
  if (!title || !url) return null;

  const location = raw.region.trim() || 'Remote';
  const description = htmlToText(raw.content || raw.description, 12_000);
  const publishedAt = parseRssDate(raw.pubDate);
  const category = normalizeJobCategory(raw.category, feedCategory, title);
  const remote = normalizeWorkArrangement(location, true);

  return {
    source: source.id,
    sourceJobId: raw.guid || url,
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
    category,
    skills: [],
    description,
    salaryMin: null,
    salaryMax: null,
    currency: 'USD',
    salaryPeriod: null,
    publishedAt,
    expiresAt: null,
    canonicalUrl: url,
    applicationUrl: url,
    employerUrl: null,
    attribution: source.attribution ?? 'Jobs by We Work Remotely',
    attributionUrl: source.attributionUrl ?? 'https://weworkremotely.com',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: source.retentionDays,
  };
}

export async function fetchWeWorkRemotely(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!takeRateLimitToken('weworkremotely', 8)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();
  let requests = 0;
  let complete = true;

  for (const feed of FEEDS) {
    if (jobs.length >= input.maxJobs) break;
    requests += 1;
    const response = await fetchProviderText(feed.url, {
      provider: 'weworkremotely',
      timeoutMs: 20_000,
      retries: 1,
      signal: input.signal,
    });
    const items = parseRssItems(response.text);
    if (items.length === 0) complete = false;

    for (const item of items) {
      if (jobs.length >= input.maxJobs) break;
      const mapped = mapWeWorkRemotelyItem(item, input.source, feed.category);
      if (!mapped || seen.has(mapped.sourceJobId)) continue;
      seen.add(mapped.sourceJobId);
      jobs.push(mapped);
    }
  }

  return {
    jobs,
    requests,
    complete: complete && jobs.length < input.maxJobs,
    latencyMs: 0,
    notes: complete ? [] : ['PARTIAL_FEED'],
  };
}
