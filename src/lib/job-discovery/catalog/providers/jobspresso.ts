import { fetchProviderText, takeRateLimitToken } from '../../http';
import { htmlToText } from '../../html';
import { inferCountryCodes, normalizeWorkArrangement } from '../../location';
import { normalizeJobCategory, normalizeSeniority } from '../../categories';
import { parseRssDate, parseRssItems, splitCompanyFromTitle, splitCreator } from '../../rss';
import type { NormalizedExternalJob, ProviderFetchInput, ProviderFetchResult } from '../../types';

const FEED_URL = 'https://jobspresso.co/feed/?post_type=job_listing';

function cleanJobspressoDescription(value: string): string | null {
  const withoutFooter = value.replace(
    /<p>\s*The post[\s\S]*?appeared first on[\s\S]*?<\/p>/gi,
    ' ',
  );
  return htmlToText(withoutFooter, 12_000);
}

export function mapJobspressoItem(
  raw: ReturnType<typeof parseRssItems>[number],
  source: ProviderFetchInput['source'],
): NormalizedExternalJob | null {
  const creator = splitCreator(raw.creator);
  const titleSplit = splitCompanyFromTitle(raw.title);
  const company = creator.company || titleSplit.company || 'Unknown employer';
  const title = (creator.company ? raw.title : titleSplit.title).trim();
  const url = (raw.link || raw.guid).trim();
  if (!title || !url) return null;

  const location = creator.location || raw.region.trim() || 'Remote';
  const description = cleanJobspressoDescription(raw.content || raw.description);
  const publishedAt = parseRssDate(raw.pubDate);
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
    category: normalizeJobCategory(title),
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
    attribution: source.attribution ?? 'Jobs by Jobspresso',
    attributionUrl: source.attributionUrl ?? 'https://jobspresso.co',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: source.retentionDays,
  };
}

export async function fetchJobspresso(input: ProviderFetchInput): Promise<ProviderFetchResult> {
  if (!takeRateLimitToken('jobspresso', 4)) {
    return { jobs: [], requests: 0, complete: false, notes: ['RATE_LIMITED'] };
  }

  const response = await fetchProviderText(FEED_URL, {
    provider: 'jobspresso',
    timeoutMs: 20_000,
    retries: 1,
    signal: input.signal,
  });
  const items = parseRssItems(response.text);
  const jobs: NormalizedExternalJob[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (jobs.length >= input.maxJobs) break;
    const mapped = mapJobspressoItem(item, input.source);
    if (!mapped || seen.has(mapped.sourceJobId)) continue;
    seen.add(mapped.sourceJobId);
    jobs.push(mapped);
  }

  return {
    jobs,
    requests: 1,
    complete: items.length > 0 && jobs.length < input.maxJobs,
    latencyMs: 0,
  };
}
