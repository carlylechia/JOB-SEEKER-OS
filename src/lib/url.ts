import { sanitizeText, sanitizeUrl } from './sanitize';
import { assertPublicHttpUrl, isUnsafeHostname } from './network-safety';

export function normalizeHttpUrl(value: unknown) {
  return sanitizeUrl(value);
}

/**
 * Synchronous best-effort check for URLs that are stored or rendered.
 *
 * This catches literal private addresses, loopback hostnames and internal
 * domains. Anything that will actually be fetched server-side must use
 * `assertSafeExternalUrl`, which also re-checks DNS and redirects.
 */
export function isSafeExternalUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    if (url.port && !['80', '443'].includes(url.port)) return false;
    return !isUnsafeHostname(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Validate a URL that the server is about to fetch. Resolves DNS and rejects
 * private/loopback/link-local/metadata addresses.
 */
export async function assertSafeExternalUrl(raw: string) {
  const normalized = normalizeHttpUrl(raw);
  if (!normalized) {
    throw new Error('Only public http(s) URLs are supported.');
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Only public http(s) URLs are supported.');
  }

  try {
    return await assertPublicHttpUrl(url);
  } catch {
    throw new Error('Only public http(s) job URLs are supported.');
  }
}

export function sourceLabelFromUrl(raw: string) {
  try {
    const url = new URL(raw);
    return sanitizeText(url.hostname.replace(/^www\./, ''), 80);
  } catch {
    return '';
  }
}
