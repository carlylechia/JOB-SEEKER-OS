import type { Connector, ConnectorHealth, ConnectorResult, ConnectorSearchInput, NormalizedExternalJob } from '../types';
import { isSafeExternalUrl } from '@/lib/url';

const TIMEOUT_MS = 10000;

function env(key: string) {
  return process.env[key]?.trim() || '';
}

function extractCompany(title: string, url: string): string {
  const atMatch = title.match(/\bat\b\s+(.+)$/i);
  if (atMatch) return atMatch[1].trim().slice(0, 120);
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, 120);
  } catch {
    return 'Unknown employer';
  }
}

export class BraveConnector implements Connector {
  id = 'brave_search';
  displayName = 'Brave Search';
  connectorType = 'web_search';

  isConfigured() {
    return Boolean(env('BRAVE_SEARCH_API_KEY'));
  }

  isEnabled() {
    return this.isConfigured() && process.env.BRAVE_SEARCH_ENABLED !== 'false';
  }

  async health(): Promise<ConnectorHealth> {
    return {
      source: this.id,
      displayName: this.displayName,
      connectorType: this.connectorType,
      configured: this.isConfigured(),
      enabled: this.isEnabled(),
      healthy: this.isEnabled(),
      message: this.isConfigured() ? undefined : 'Missing BRAVE_SEARCH_API_KEY',
    };
  }

  async search(input: ConnectorSearchInput): Promise<ConnectorResult> {
    if (!this.isEnabled()) {
      return { source: this.id, jobs: [], errors: ['NOT_CONFIGURED'] };
    }
    const key = env('BRAVE_SEARCH_API_KEY');
    const jobs: NormalizedExternalJob[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const title of input.titles.slice(0, 3)) {
      for (const location of (input.locations.length ? input.locations.slice(0, 2) : [''])) {
        const q = `${title} job opening ${location} site:jobs OR careers`.trim();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const params = new URLSearchParams({ q, count: String(Math.min(input.limit, 10)) });
          const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
            signal: controller.signal,
            cache: 'no-store',
            headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
          });
          if (!res.ok) {
            errors.push(`HTTP_${res.status}`);
            continue;
          }
          const data = await res.json();
          const results = Array.isArray(data?.web?.results) ? data.web.results : [];
          for (const r of results) {
            const url = typeof r?.url === 'string' ? r.url : '';
            if (!url || !isSafeExternalUrl(url) || seen.has(url)) continue;
            seen.add(url);
            const t = String(r?.title ?? '').trim();
            jobs.push({
              source: this.id,
              sourceJobId: url,
              title: t || title,
              company: extractCompany(t, url),
              location: location || null,
              description: r?.description ? String(r.description) : null,
              publishedAt: null,
              applicationUrl: url,
              canonicalUrl: url,
              attribution: 'Discovered via Brave Search',
            });
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : 'unknown');
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    return { source: this.id, jobs: jobs.slice(0, input.limit * 3), errors: errors.length ? errors : undefined };
  }
}
