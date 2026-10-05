const FALLBACK_APP_URL = 'http://localhost:3000';

/**
 * Resolves an absolute app origin from configuration.
 *
 * Deployments commonly store `NEXT_PUBLIC_APP_URL` as a bare host
 * (e.g. "example.com" with no scheme). `new URL()` rejects that, so the value
 * is normalised to https:// before parsing and this helper never throws — build
 * output, sitemap/robots entries and transactional email links all depend on it.
 */
export function resolveAppUrl(raw?: string | null): string {
  const value = (raw ?? '').trim();

  if (!value) return FALLBACK_APP_URL;

  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    return new URL(candidate).toString().replace(/\/+$/, '');
  } catch {
    return FALLBACK_APP_URL;
  }
}

/** Canonical app origin, e.g. "https://example.com". */
export function getAppUrl(): string {
  return resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL);
}