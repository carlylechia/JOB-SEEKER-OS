import type { Connector, ConnectorHealth, ConnectorResult, ConnectorSearchInput, NormalizedExternalJob } from '../types';
import { isSafeExternalUrl } from '@/lib/url';

const TIMEOUT_MS = 10000;

function env(key: string) {
  return process.env[key]?.trim() || '';
}

export class AdzunaConnector implements Connector {
  id = 'adzuna';
  displayName = 'Adzuna';
  connectorType = 'aggregator_api';

  isConfigured() {
    return Boolean(env('ADZUNA_APP_ID') && env('ADZUNA_APP_KEY'));
  }

  isEnabled() {
    return this.isConfigured() && process.env.ADZUNA_ENABLED !== 'false';
  }

  async health(): Promise<ConnectorHealth> {
    return {
      source: this.id,
      displayName: this.displayName,
      connectorType: this.connectorType,
      configured: this.isConfigured(),
      enabled: this.isEnabled(),
      healthy: this.isEnabled(),
      message: this.isConfigured() ? undefined : 'Missing ADZUNA_APP_ID / ADZUNA_APP_KEY',
    };
  }

  async search(input: ConnectorSearchInput): Promise<ConnectorResult> {
    if (!this.isEnabled()) {
      return { source: this.id, jobs: [], errors: ['NOT_CONFIGURED'] };
    }
    const appId = env('ADZUNA_APP_ID');
    const appKey = env('ADZUNA_APP_KEY');
    const country = (env('ADZUNA_COUNTRY') || 'us').toLowerCase();
    const jobs: NormalizedExternalJob[] = [];
    const errors: string[] = [];

    for (const title of input.titles.slice(0, 5)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const params = new URLSearchParams({
          app_id: appId,
          app_key: appKey,
          results_per_page: String(Math.min(input.limit, 20)),
          what: title,
        });
        if (input.locations.length) params.set('where', input.locations[0]);
        const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params.toString()}`;
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) {
          errors.push(`HTTP_${res.status}`);
          continue;
        }
        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        for (const r of results) {
          const redirect = typeof r?.redirect_url === 'string' ? r.redirect_url : null;
          const urlCandidate = redirect && isSafeExternalUrl(redirect) ? redirect : null;
          jobs.push({
            source: this.id,
            sourceJobId: String(r?.id ?? r?.adref ?? `${title}-${jobs.length}`),
            title: String(r?.title ?? '').trim(),
            company: String(r?.company?.display_name ?? r?.company?.name ?? '').trim(),
            location: r?.location?.display_name ? String(r.location.display_name) : null,
            description: r?.description ? String(r.description) : null,
            salaryMin: typeof r?.salary_min === 'number' ? Math.round(r.salary_min) : null,
            salaryMax: typeof r?.salary_max === 'number' ? Math.round(r.salary_max) : null,
            currency: country === 'gb' ? 'GBP' : 'USD',
            publishedAt: r?.created ? new Date(r.created) : null,
            applicationUrl: urlCandidate,
            canonicalUrl: urlCandidate,
            attribution: 'Job data provided by Adzuna',
          });
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'unknown');
      } finally {
        clearTimeout(timeout);
      }
    }

    return { source: this.id, jobs: jobs.filter((j) => j.title && j.company), errors: errors.length ? errors : undefined };
  }
}
