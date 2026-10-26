import type { Connector, ConnectorHealth, ConnectorResult, ConnectorSearchInput, NormalizedExternalJob } from '../types';
import { isSafeExternalUrl } from '@/lib/url';

const TIMEOUT_MS = 10000;

function env(key: string) {
  return process.env[key]?.trim() || '';
}

function tokens() {
  return env('GREENHOUSE_BOARD_TOKENS')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export class GreenhouseConnector implements Connector {
  id = 'greenhouse';
  displayName = 'Greenhouse';
  connectorType = 'ats_public_board';

  isConfigured() {
    return tokens().length > 0;
  }

  isEnabled() {
    return this.isConfigured() && process.env.GREENHOUSE_ENABLED !== 'false';
  }

  async health(): Promise<ConnectorHealth> {
    return {
      source: this.id,
      displayName: this.displayName,
      connectorType: this.connectorType,
      configured: this.isConfigured(),
      enabled: this.isEnabled(),
      healthy: this.isEnabled(),
      message: this.isConfigured() ? undefined : 'Missing GREENHOUSE_BOARD_TOKENS',
    };
  }

  async search(input: ConnectorSearchInput): Promise<ConnectorResult> {
    if (!this.isEnabled()) {
      return { source: this.id, jobs: [], errors: ['NOT_CONFIGURED'] };
    }
    const jobs: NormalizedExternalJob[] = [];
    const errors: string[] = [];
    const lowerTitles = input.titles.map((t) => t.toLowerCase());

    for (const token of tokens()) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) {
          errors.push(`HTTP_${res.status}`);
          continue;
        }
        const data = await res.json();
        const postings = Array.isArray(data?.jobs) ? data.jobs : [];
        for (const p of postings) {
          const title = String(p?.title ?? '').trim();
          if (!title) continue;
          if (lowerTitles.length && !lowerTitles.some((t) => title.toLowerCase().includes(t.toLowerCase().split(' ')[0]))) {
            // still allow if no titles; otherwise filter loosely
            if (lowerTitles.length > 0) continue;
          }
          const absoluteUrl = typeof p?.absolute_url === 'string' ? p.absolute_url : null;
          const url = absoluteUrl && isSafeExternalUrl(absoluteUrl) ? absoluteUrl : null;
          const content = typeof p?.content === 'string' ? p.content.replace(/<[^>]+>/g, ' ').trim() : null;
          const location = p?.location?.name ? String(p.location.name) : null;
          jobs.push({
            source: this.id,
            sourceJobId: String(p?.id ?? `${token}-${title}`),
            title,
            company: token,
            location,
            description: content,
            publishedAt: p?.updated_at ? new Date(p.updated_at) : null,
            applicationUrl: url,
            canonicalUrl: url,
            attribution: 'Greenhouse public board',
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
