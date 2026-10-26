import type { Connector, ConnectorHealth, ConnectorResult, ConnectorSearchInput, NormalizedExternalJob } from '../types';
import { isSafeExternalUrl } from '@/lib/url';

const TIMEOUT_MS = 10000;

function env(key: string) {
  return process.env[key]?.trim() || '';
}

function sites() {
  return env('LEVER_SITES')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export class LeverConnector implements Connector {
  id = 'lever';
  displayName = 'Lever';
  connectorType = 'ats_public_postings';

  isConfigured() {
    return sites().length > 0;
  }

  isEnabled() {
    return this.isConfigured() && process.env.LEVER_ENABLED !== 'false';
  }

  async health(): Promise<ConnectorHealth> {
    return {
      source: this.id,
      displayName: this.displayName,
      connectorType: this.connectorType,
      configured: this.isConfigured(),
      enabled: this.isEnabled(),
      healthy: this.isEnabled(),
      message: this.isConfigured() ? undefined : 'Missing LEVER_SITES',
    };
  }

  async search(input: ConnectorSearchInput): Promise<ConnectorResult> {
    if (!this.isEnabled()) {
      return { source: this.id, jobs: [], errors: ['NOT_CONFIGURED'] };
    }
    const jobs: NormalizedExternalJob[] = [];
    const errors: string[] = [];
    const lowerTitles = input.titles.map((t) => t.toLowerCase());

    for (const site of sites()) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) {
          errors.push(`HTTP_${res.status}`);
          continue;
        }
        const data = await res.json();
        const postings = Array.isArray(data) ? data : [];
        for (const p of postings) {
          const title = String(p?.text ?? '').trim();
          if (!title) continue;
          if (lowerTitles.length && !lowerTitles.some((t) => title.toLowerCase().includes(t.toLowerCase().split(' ')[0]))) {
            if (lowerTitles.length > 0) continue;
          }
          const hostedUrl = typeof p?.hostedUrl === 'string' ? p.hostedUrl : null;
          const applyUrl = typeof p?.applyUrl === 'string' ? p.applyUrl : null;
          const url = (applyUrl || hostedUrl) && isSafeExternalUrl(applyUrl || hostedUrl) ? (applyUrl || hostedUrl) : (hostedUrl && isSafeExternalUrl(hostedUrl) ? hostedUrl : null);
          const location = p?.categories?.location ? String(p.categories.location) : null;
          const description = typeof p?.descriptionPlain === 'string' ? p.descriptionPlain : (typeof p?.description === 'string' ? p.description.replace(/<[^>]+>/g, ' ').trim() : null);
          jobs.push({
            source: this.id,
            sourceJobId: String(p?.id ?? `${site}-${title}`),
            title,
            company: site,
            location,
            description,
            publishedAt: p?.createdAt ? new Date(p.createdAt) : null,
            applicationUrl: url,
            canonicalUrl: hostedUrl && isSafeExternalUrl(hostedUrl) ? hostedUrl : url,
            attribution: 'Lever public postings',
          });
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'unknown');
      } finally {
        clearTimeout(timeout);
      }
    }

    return { source: this.id, jobs: jobs.slice(0, input.limit * 5), errors: errors.length ? errors : undefined };
  }
}
