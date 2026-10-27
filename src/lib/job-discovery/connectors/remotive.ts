import type { Connector, ConnectorHealth, ConnectorResult, ConnectorSearchInput, NormalizedExternalJob } from '../types';
import { isSafeExternalUrl } from '@/lib/url';

const TIMEOUT_MS = 10000;

export class RemotiveConnector implements Connector {
  id = 'remotive';
  displayName = 'Remotive';
  connectorType = 'free_aggregator';

  isConfigured() {
    return true; // public, no credentials
  }

  isEnabled() {
    return process.env.REMOTIVE_ENABLED !== 'false';
  }

  async health(): Promise<ConnectorHealth> {
    return {
      source: this.id,
      displayName: this.displayName,
      connectorType: this.connectorType,
      configured: true,
      enabled: this.isEnabled(),
      healthy: this.isEnabled(),
    };
  }

  async search(input: ConnectorSearchInput): Promise<ConnectorResult> {
    if (!this.isEnabled()) return { source: this.id, jobs: [], errors: ['DISABLED'] };
    const jobs: NormalizedExternalJob[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const title of input.titles) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const params = new URLSearchParams({ search: title, limit: String(Math.min(input.limit, 20)) });
        const res = await fetch(`https://remotive.com/api/remote-jobs?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) { errors.push(`HTTP_${res.status}`); continue; }
        const data = await res.json();
        const results = Array.isArray(data?.jobs) ? data.jobs : [];
        for (const r of results) {
          const url = typeof r?.url === 'string' ? r.url : '';
          if (!url || !isSafeExternalUrl(url) || seen.has(url)) continue;
          seen.add(url);
          jobs.push({
            source: this.id,
            sourceJobId: String(r?.id ?? url),
            title: String(r?.title ?? title).trim(),
            company: String(r?.company_name ?? 'Unknown employer').trim(),
            location: r?.candidate_required_location ? String(r.candidate_required_location) : 'Remote',
            remoteType: 'Remote',
            workArrangement: 'Remote',
            employmentType: r?.job_type ? String(r.job_type) : null,
            description: r?.description ? String(r.description).replace(/<[^>]+>/g, ' ').trim().slice(0, 2000) : null,
            salaryMin: null,
            salaryMax: null,
            currency: 'USD',
            publishedAt: r?.publication_date ? new Date(r.publication_date) : null,
            applicationUrl: url,
            canonicalUrl: url,
            attribution: 'Job data provided by Remotive',
          });
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'unknown');
      } finally {
        clearTimeout(timeout);
      }
    }

    return { source: this.id, jobs: jobs.slice(0, input.limit * 3), errors: errors.length ? errors : undefined };
  }
}
