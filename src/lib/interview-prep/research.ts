/**
 * Company and role research.
 *
 * There is deliberately NO web-search provider here. Research is limited to
 * pages the user explicitly supplies (company site, careers page, newsroom,
 * filings) plus the job description they already gave us. That keeps the
 * feature honest: every claim can be traced to a source we actually hold.
 *
 * Fetching is treated as hostile input:
 *  - only http(s), no credentials, only 80/443;
 *  - DNS is resolved and private/loopback/link-local/metadata ranges rejected;
 *  - every redirect is revalidated;
 *  - responses are bounded in bytes and time;
 *  - only text/html, xhtml and plain text are parsed.
 *
 * If research is unavailable the pack still generates from the job posting
 * and the candidate's profile, with the gap stated explicitly.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  INTERVIEW_PREP_MAX_REDIRECTS,
  INTERVIEW_PREP_MAX_RESEARCH_BYTES,
  INTERVIEW_PREP_MAX_RESEARCH_URLS,
  INTERVIEW_PREP_MAX_SOURCE_EXCERPT_CHARS,
  INTERVIEW_PREP_MAX_SOURCES,
  INTERVIEW_PREP_MAX_SOURCE_TEXT_CHARS,
  INTERVIEW_PREP_RESEARCH_TIMEOUT_MS,
  INTERVIEW_PREP_RESEARCH_TOTAL_BUDGET_MS,
} from './limits';
import type {
  ResearchFetchStatus,
  ResearchSourceKind,
  ResearchStatus,
  ResearchVerification,
} from './schema';
import { normalizeHttpUrl } from '@/lib/url';

export type ResearchSource = {
  kind: ResearchSourceKind;
  url: string | null;
  canonicalUrl: string | null;
  title: string;
  publisher: string | null;
  publishedAt: Date | null;
  retrievedAt: Date | null;
  excerpt: string;
  summary: string | null;
  fetchStatus: ResearchFetchStatus;
  verification: ResearchVerification;
  errorCode: string | null;
  /** Full bounded extracted text used for prompting. Not persisted separately. */
  text: string;
};

export type ResearchBundle = {
  sources: ResearchSource[];
  status: ResearchStatus;
  fetchedCount: number;
  attemptedCount: number;
  errorCodes: string[];
  limitations: string[];
};

export type FetchedPage = {
  url: string;
  canonicalUrl: string;
  title: string;
  description: string | null;
  text: string;
  publishedAt: Date | null;
};

export class ResearchFetchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ResearchFetchError';
    this.code = code;
  }
}

// ─── Address safety ────────────────────────────────────────────────────────

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0) return true; // "this" network
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true; // documentation
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast/reserved/broadcast
  return false;
}

function isPrivateIpv6(raw: string): boolean {
  const address = raw.toLowerCase().split('%')[0];
  if (address === '::' || address === '::1') return true;
  if (address.startsWith('fc') || address.startsWith('fd')) return true; // unique local
  if (/^fe[89ab]/.test(address)) return true; // link-local
  if (address.startsWith('::ffff:')) {
    const tail = address.slice('::ffff:'.length);
    const mapped = parseIpv4(tail);
    if (mapped) return isPrivateIpv4(mapped);
    // Hex-encoded IPv4-mapped address, e.g. ::ffff:7f00:1
    const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
    }
  }
  return false;
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = parseIpv4(address);
    return octets ? !isPrivateIpv4(octets) : false;
  }
  if (family === 6) return !isPrivateIpv6(address);
  return false;
}

/** Validate a URL and every address its hostname currently resolves to. */
export async function assertSafeResearchUrl(raw: string): Promise<URL> {
  const normalised = normalizeHttpUrl(raw);
  if (!normalised) throw new ResearchFetchError('RESEARCH_URL_INVALID', 'That URL is not valid.');

  let url: URL;
  try {
    url = new URL(normalised);
  } catch {
    throw new ResearchFetchError('RESEARCH_URL_INVALID', 'That URL is not valid.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ResearchFetchError('RESEARCH_URL_UNSAFE', 'Only public http and https pages can be read.');
  }
  if (url.username || url.password) {
    throw new ResearchFetchError('RESEARCH_URL_UNSAFE', 'URLs containing credentials cannot be read.');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new ResearchFetchError('RESEARCH_URL_UNSAFE', 'Only standard web ports can be read.');
  }
  const hostname = url.hostname.trim().toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new ResearchFetchError('RESEARCH_URL_UNSAFE', 'Private addresses cannot be read.');
  }

  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new ResearchFetchError('RESEARCH_URL_UNSAFE', 'Private addresses cannot be read.');
    }
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new ResearchFetchError('RESEARCH_DNS_FAILED', 'That hostname could not be resolved.');
  }
  if (!addresses.length || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    throw new ResearchFetchError('RESEARCH_URL_UNSAFE', 'Private addresses cannot be read.');
  }

  return url;
}

// ─── Fetching ──────────────────────────────────────────────────────────────

const ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];

function isAllowedContentType(value: string | null): boolean {
  if (!value) return true;
  const type = value.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(type);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ResearchFetchError('RESEARCH_TOO_LARGE', 'That page is too large to read.');
  }
  if (!response.body) throw new ResearchFetchError('RESEARCH_EMPTY', 'That page returned no content.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResearchFetchError('RESEARCH_TOO_LARGE', 'That page is too large to read.');
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function textFromHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

function attribute(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : null;
}

function parsePublishedAt(html: string): Date | null {
  const raw =
    attribute(html, /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i) ??
    attribute(html, /<meta[^>]+name=["']article:published_time["'][^>]+content=["']([^"']+)["']/i) ??
    attribute(html, /<time[^>]+datetime=["']([^"']+)["']/i);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractPage(finalUrl: string, html: string): FetchedPage {
  const title =
    attribute(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ??
    attribute(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    new URL(finalUrl).hostname;

  const description =
    attribute(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    attribute(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  const canonical =
    attribute(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ??
    attribute(html, /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i) ??
    finalUrl;

  const main = attribute(html, /<main[^>]*>([\s\S]*?)<\/main>/i) ?? attribute(html, /<article[^>]*>([\s\S]*?)<\/article>/i);
  const text = textFromHtml(main ?? html).slice(0, INTERVIEW_PREP_MAX_SOURCE_TEXT_CHARS);

  return {
    url: finalUrl,
    canonicalUrl: canonical,
    title: title.slice(0, 220),
    description: description ? description.slice(0, 600) : null,
    text,
    publishedAt: parsePublishedAt(html),
  };
}

/**
 * Fetch one public page with redirect revalidation and byte/time bounds.
 */
export async function fetchPublicPage(
  rawUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<FetchedPage> {
  let current = await assertSafeResearchUrl(rawUrl);
  const timeoutMs = options.timeoutMs ?? INTERVIEW_PREP_RESEARCH_TIMEOUT_MS;

  for (let redirect = 0; redirect <= INTERVIEW_PREP_MAX_REDIRECTS; redirect += 1) {
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': 'teChiaJobs/1.0 interview preparation research (https://techia.jobs)',
          accept: 'text/html, application/xhtml+xml, text/plain;q=0.8',
          'accept-language': 'en',
        },
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ResearchFetchError('RESEARCH_TIMEOUT', 'That page took too long to respond.');
      }
      throw new ResearchFetchError('RESEARCH_FETCH_FAILED', 'That page could not be reached.');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new ResearchFetchError('RESEARCH_REDIRECT_FAILED', 'That page redirected without a destination.');
      if (redirect === INTERVIEW_PREP_MAX_REDIRECTS) {
        throw new ResearchFetchError('RESEARCH_REDIRECT_FAILED', 'That page redirected too many times.');
      }
      current = await assertSafeResearchUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) {
      throw new ResearchFetchError('RESEARCH_FETCH_FAILED', `That page returned status ${response.status}.`);
    }
    if (!isAllowedContentType(response.headers.get('content-type'))) {
      throw new ResearchFetchError('RESEARCH_UNSUPPORTED_CONTENT', 'That page is not readable text.');
    }

    const body = await readBoundedBody(response, INTERVIEW_PREP_MAX_RESEARCH_BYTES);
    return extractPage(current.toString(), body);
  }

  throw new ResearchFetchError('RESEARCH_REDIRECT_FAILED', 'That page redirected too many times.');
}

// ─── Source assembly ───────────────────────────────────────────────────────

export function classifySourceKind(url: string): ResearchSourceKind {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'OTHER';
  }
  const path = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  if (/\/(careers?|jobs?|join|work-with-us|opportunities)\b/.test(path)) return 'OFFICIAL_CAREERS';
  if (/\/(newsroom|press|news|media|blog)\b/.test(path)) return 'OFFICIAL_NEWSROOM';
  if (/\/(investor|investors|filings?|annual-report|reports?)\b/.test(path)) return 'OFFICIAL_FILING';
  if (/(techcrunch|reuters|bloomberg|forbes|businessinsider|cnbc|ft\.com|wsj|nytimes|theverge|wired)\./.test(parsed.hostname)) {
    return 'NEWS';
  }
  return 'OFFICIAL_COMPANY';
}

function publisherFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown publisher';
  }
}

function sourceTitle(page: FetchedPage): string {
  return page.title.trim() || publisherFor(page.url);
}

function summaryFor(page: FetchedPage): string | null {
  const description = page.description?.trim();
  if (description) return description.slice(0, 600);
  const text = page.text.trim();
  return text ? `${text.slice(0, 300)}${text.length > 300 ? '…' : ''}` : null;
}

function limitationFor(code: string, url: string): string {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // keep raw value
  }
  switch (code) {
    case 'RESEARCH_URL_INVALID':
      return `One research URL was not valid and was skipped.`;
    case 'RESEARCH_URL_UNSAFE':
      return `A research URL on ${host} pointed to a private or unsafe address and was skipped.`;
    case 'RESEARCH_DNS_FAILED':
      return `The research host ${host} could not be resolved, so its content was not used.`;
    case 'RESEARCH_TIMEOUT':
      return `The research page on ${host} took too long to respond and was skipped.`;
    case 'RESEARCH_TOO_LARGE':
      return `The research page on ${host} was too large to read and was skipped.`;
    case 'RESEARCH_UNSUPPORTED_CONTENT':
      return `The research page on ${host} was not readable text and was skipped.`;
    default:
      return `The research page on ${host} could not be read and was skipped.`;
  }
}

/** Unique, valid-looking research URLs, capped before any network call. */
export function normaliseResearchUrls(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    const normalised = normalizeHttpUrl(raw);
    if (!normalised) continue;
    // A fragment never changes the fetched document, so strip it before
    // deduplicating. Otherwise the same page can consume several source slots.
    // Relative /uploads paths are valid elsewhere in the app, but never here.
    let canonical: URL;
    try {
      canonical = new URL(normalised);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(canonical.protocol)) continue;
    canonical.hash = '';
    const url = canonical.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= INTERVIEW_PREP_MAX_RESEARCH_URLS) break;
  }
  return result;
}

/**
 * Build the research bundle.
 *
 * The job description is always source 0 when present, so citations are
 * stable. Fetched pages follow in user-supplied order. Failures are recorded
 * as limitations rather than silently disappearing.
 */
export async function buildResearchBundle(params: {
  jobDescription: string | null;
  companyWebsiteUrl: string | null;
  careersUrl: string | null;
  researchUrls: string[];
  now?: Date;
}): Promise<ResearchBundle> {
  const now = params.now ?? new Date();
  const sources: ResearchSource[] = [];
  const limitations: string[] = [];
  const errorCodes: string[] = [];

  const jobDescription = params.jobDescription?.trim() ?? '';
  if (jobDescription) {
    sources.push({
      kind: 'JOB_DESCRIPTION',
      url: null,
      canonicalUrl: null,
      title: 'Job description supplied by the candidate',
      publisher: null,
      publishedAt: null,
      retrievedAt: null,
      excerpt: jobDescription.slice(0, INTERVIEW_PREP_MAX_SOURCE_EXCERPT_CHARS),
      summary: 'The role description the candidate is preparing against.',
      fetchStatus: 'USER_SUPPLIED',
      verification: 'USER_SUPPLIED',
      errorCode: null,
      text: jobDescription,
    });
  }

  const urls = normaliseResearchUrls([
    params.careersUrl,
    params.companyWebsiteUrl,
    ...params.researchUrls,
  ]);

  if (urls.length === 0) {
    limitations.push(
      'No official company pages were supplied, so company context is limited to the job description and anything the candidate added. We did not search the web or invent company facts.',
    );
    return {
      sources,
      status: 'NOT_AVAILABLE',
      fetchedCount: 0,
      attemptedCount: 0,
      errorCodes,
      limitations,
    };
  }

  const deadline = Date.now() + INTERVIEW_PREP_RESEARCH_TOTAL_BUDGET_MS;
  let fetchedCount = 0;

  for (const url of urls) {
    if (Date.now() >= deadline) {
      errorCodes.push('RESEARCH_BUDGET_EXHAUSTED');
      limitations.push('The research budget ran out before every supplied page could be read.');
      break;
    }

    const remaining = Math.min(INTERVIEW_PREP_RESEARCH_TIMEOUT_MS, Math.max(1_000, deadline - Date.now()));

    try {
      const page = await fetchPublicPage(url, { timeoutMs: remaining });
      fetchedCount += 1;
      const text = page.text.slice(0, INTERVIEW_PREP_MAX_SOURCE_TEXT_CHARS);
      sources.push({
        kind: classifySourceKind(page.canonicalUrl || url),
        url,
        canonicalUrl: page.canonicalUrl,
        title: sourceTitle(page),
        publisher: publisherFor(page.url),
        publishedAt: page.publishedAt,
        retrievedAt: now,
        excerpt: text.slice(0, INTERVIEW_PREP_MAX_SOURCE_EXCERPT_CHARS),
        summary: summaryFor(page),
        fetchStatus: 'FETCHED',
        verification: 'SOURCE_BACKED',
        errorCode: null,
        text,
      });
    } catch (error) {
      const code = error instanceof ResearchFetchError ? error.code : 'RESEARCH_FETCH_FAILED';
      errorCodes.push(code);
      limitations.push(limitationFor(code, url));
      sources.push({
        kind: classifySourceKind(url),
        url,
        canonicalUrl: null,
        title: publisherFor(url),
        publisher: publisherFor(url),
        publishedAt: null,
        retrievedAt: now,
        excerpt: '',
        summary: null,
        fetchStatus: 'FAILED',
        verification: 'UNVERIFIED',
        errorCode: code,
        text: '',
      });
    }

    if (sources.length >= INTERVIEW_PREP_MAX_SOURCES) break;
  }

  const attemptedCount = urls.length;
  const failedCount = sources.filter((source) => source.fetchStatus === 'FAILED').length;

  let status: ResearchStatus;
  if (fetchedCount === 0) status = 'FAILED';
  else if (failedCount > 0) status = 'PARTIAL';
  else status = 'COMPLETED';

  return {
    sources: sources.slice(0, INTERVIEW_PREP_MAX_SOURCES),
    status,
    fetchedCount,
    attemptedCount,
    errorCodes,
    limitations,
  };
}

// ─── Job URL import ────────────────────────────────────────────────────────

function guessCompanyFromTitle(title: string): string | null {
  const patterns = [
    /\bat\s+([A-Z][A-Za-z0-9&.'’ -]{1,80})$/,
    /\b([A-Z][A-Za-z0-9&.'’ -]{1,80})\s+(?:is\s+)?(?:hiring|seeks|looking for)\b/,
    /\s[-|–—]\s+([A-Z][A-Za-z0-9&.'’ -]{1,80})$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(title);
    if (match) return match[1].replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  return null;
}

/**
 * Fetch a public job posting supplied by the user and extract the fields the
 * manual-pack form needs. This is not a scraper: one page, no crawling.
 */
export async function importJobPosting(rawUrl: string): Promise<{
  url: string;
  title: string;
  company: string;
  description: string;
  location: string | null;
}> {
  const page = await fetchPublicPage(rawUrl, { timeoutMs: 8_000 });
  const text = page.text.trim();
  if (text.length < 80) {
    throw new ResearchFetchError('JOB_URL_UNREADABLE', 'That page did not contain a readable job description.');
  }

  const firstLine = text.split('\n').map((line) => line.trim()).find((line) => line.length >= 4) ?? '';
  const title = page.title.replace(/\s*[|–—]\s*.*$/, '').trim().slice(0, 200) || firstLine.slice(0, 200);
  const company = guessCompanyFromTitle(page.title) ?? publisherFor(page.url);
  const locationMatch = /\b(?:location|based in|office)\s*[:\-–]\s*([^\n]{2,120})/i.exec(text);
  const location = locationMatch ? locationMatch[1].trim().slice(0, 200) : null;

  return {
    url: page.canonicalUrl || page.url,
    title,
    company,
    description: text.slice(0, 20_000),
    location,
  };
}
