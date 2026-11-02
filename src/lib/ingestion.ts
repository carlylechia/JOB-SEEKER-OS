import { extractJobFields } from './extract-job-fields';
import { assertSafeExternalUrl } from './url';

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2_000_000;

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleFromHtml(html: string) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1];
  const metaTitle = html.match(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)/i)?.[1];
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return ogTitle || metaTitle || title || '';
}

function extractDescriptionFromHtml(html: string) {
  return html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] || '';
}

function extractJsonLdText(html: string) {
  const matches = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  return matches.map((match) => match[1]).join('\n');
}

/**
 * Read a response body with a hard byte cap.
 *
 * `response.text()` would buffer an arbitrarily large page before any size
 * check, so the stream is read chunk-by-chunk and cancelled as soon as the
 * limit is crossed.
 */
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('That job page is too large to read.');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('That job page is too large to read.');
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

/**
 * Fetch a job page manually so every redirect hop is re-validated. Following
 * redirects automatically would let a public URL bounce to 127.0.0.1 or a
 * cloud metadata endpoint after the initial check.
 */
async function fetchJobPage(
  rawUrl: string,
  signal: AbortSignal,
): Promise<{ html: string; finalUrl: string }> {
  let current = await assertSafeExternalUrl(rawUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current.toString(), {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'teChiaJobs/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
      cache: 'no-store',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error('That job page redirected without a destination.');
      if (redirect === MAX_REDIRECTS) throw new Error('That job page redirected too many times.');
      current = await assertSafeExternalUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) throw new Error(`Unable to fetch job posting (${response.status}).`);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Only HTML job pages can be parsed right now.');
    }

    const html = await readBoundedText(response, MAX_HTML_BYTES);
    return { html, finalUrl: current.toString() };
  }

  throw new Error('That job page redirected too many times.');
}

export async function ingestJobInput(input: { jobUrl?: string; jobDescription?: string }) {
  let combinedText = input.jobDescription?.trim() || '';
  let pageTitle = '';
  let fetchedUrl = '';

  if (input.jobUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const page = await fetchJobPage(input.jobUrl, controller.signal);
      pageTitle = extractTitleFromHtml(page.html);
      const description = extractDescriptionFromHtml(page.html);
      const structured = extractJsonLdText(page.html);
      combinedText = [combinedText, pageTitle, description, structured, stripHtml(page.html)]
        .filter(Boolean)
        .join('\n\n');
      fetchedUrl = page.finalUrl;
    } finally {
      clearTimeout(timeout);
    }
  }

  const extracted = extractJobFields({ text: combinedText, jobUrl: input.jobUrl, pageTitle });
  return {
    ...extracted,
    fetchedUrl,
    sourceMode: input.jobUrl ? (input.jobDescription ? 'url+description' : 'url') : 'description',
  };
}
