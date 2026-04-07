import { extractJobFields } from './extract-job-fields';
import { isSafeExternalUrl } from './url';

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

export async function ingestJobInput(input: { jobUrl?: string; jobDescription?: string }) {
  let combinedText = input.jobDescription?.trim() || '';
  let pageTitle = '';
  let fetchedUrl = '';

  if (input.jobUrl) {
    if (!isSafeExternalUrl(input.jobUrl)) throw new Error('Only public http(s) job URLs are supported.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(input.jobUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'JobSeekerOS/1.0 (+https://job-seeker-os.vercel.app)',
          Accept: 'text/html,application/xhtml+xml',
        },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Unable to fetch job posting (${response.status}).`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) throw new Error('Only HTML job pages can be parsed right now.');

      const html = await response.text();
      pageTitle = extractTitleFromHtml(html);
      const description = extractDescriptionFromHtml(html);
      const structured = extractJsonLdText(html);
      combinedText = [combinedText, pageTitle, description, structured, stripHtml(html)].filter(Boolean).join('\n\n');
      fetchedUrl = input.jobUrl;
    } finally {
      clearTimeout(timeout);
    }
  }

  const extracted = extractJobFields({ text: combinedText, jobUrl: input.jobUrl, pageTitle });
  return { ...extracted, fetchedUrl, sourceMode: input.jobUrl ? (input.jobDescription ? 'url+description' : 'url') : 'description' };
}
