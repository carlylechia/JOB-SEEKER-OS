import { createHash } from 'node:crypto';
import type { NormalizedExternalJob } from './types';

export function normalizeCompany(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function fingerprintJob(job: NormalizedExternalJob): string {
  const payload = {
    title: normalizeTitle(job.title),
    company: normalizeCompany(job.company),
    location: (job.location ?? '').toLowerCase().trim(),
    url: job.applicationUrl ?? job.canonicalUrl ?? '',
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function normalizeJob(job: NormalizedExternalJob): NormalizedExternalJob {
  return {
    ...job,
    title: job.title.trim(),
    company: job.company.trim() || 'Unknown employer',
    location: job.location?.trim() || null,
    currency: job.currency?.trim().toUpperCase() || 'USD',
    publishedAt: job.publishedAt && !isNaN(job.publishedAt.getTime()) ? job.publishedAt : null,
    contentFingerprint: job.contentFingerprint || fingerprintJob(job),
  };
}
