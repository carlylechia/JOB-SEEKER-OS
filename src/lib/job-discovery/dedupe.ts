import type { NormalizedExternalJob } from './types';
import { normalizeCompany, normalizeTitle } from './normalize';

export type DedupeResult = {
  jobs: NormalizedExternalJob[];
  discarded: number;
};

export function dedupeExternalJobs(jobs: NormalizedExternalJob[]): DedupeResult {
  const seenKeys = new Set<string>();
  const out: NormalizedExternalJob[] = [];
  let discarded = 0;

  for (const job of jobs) {
    const keys = [
      `${job.source}:${job.sourceJobId}`,
      job.applicationUrl ? `url:${job.applicationUrl}` : null,
      job.canonicalUrl ? `canon:${job.canonicalUrl}` : null,
      job.contentFingerprint ? `fp:${job.contentFingerprint}` : null,
      `ct:${normalizeCompany(job.company)}|${normalizeTitle(job.title)}|${(job.location ?? '').toLowerCase().trim()}`,
    ].filter(Boolean) as string[];

    if (keys.some((k) => seenKeys.has(k))) {
      discarded += 1;
      continue;
    }
    for (const k of keys) seenKeys.add(k);
    out.push(job);
  }

  return { jobs: out, discarded };
}
