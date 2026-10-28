import { PROVIDER_DEFINITIONS } from './catalog/providers';
import type { NormalizedExternalJob } from './types';

export type JobConfidences = {
  listingQuality: number;
  sourceConfidence: number;
  dataConfidence: number;
};

type ConfidenceInput = Pick<
  NormalizedExternalJob,
  | 'company'
  | 'title'
  | 'description'
  | 'location'
  | 'salaryMin'
  | 'salaryMax'
  | 'applicationUrl'
  | 'attribution'
  | 'employmentType'
  | 'seniority'
  | 'publishedAt'
  | 'countryCodes'
  | 'industry'
  | 'category'
  | 'source'
>;

function bounded(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

/** How complete and useful the listing itself is, independent of the user. */
export function computeListingQuality(job: ConfidenceInput): number {
  let score = 0;
  if (job.company && job.company !== 'Unknown employer') score += 0.12;
  if (job.title.trim().length >= 4) score += 0.08;
  if (job.description && job.description.length >= 300) score += 0.25;
  else if (job.description && job.description.length >= 80) score += 0.12;
  if (job.applicationUrl) score += 0.2;
  if (job.location) score += 0.08;
  if (job.salaryMin != null || job.salaryMax != null) score += 0.12;
  if (job.publishedAt) score += 0.08;
  if (job.employmentType) score += 0.04;
  if (job.seniority) score += 0.03;
  return bounded(score);
}

/** Trust in the source itself, with freshness and link checks. */
export function computeSourceConfidence(
  source: string,
  options: { lastSeenAt?: Date | null; applicationUrl?: string | null; now?: Date } = {},
): number {
  const definition = PROVIDER_DEFINITIONS[source as keyof typeof PROVIDER_DEFINITIONS];
  let score = definition?.sourceConfidence ?? 0.45;
  const now = options.now?.getTime() ?? Date.now();
  if (options.lastSeenAt) {
    const ageDays = Math.max(0, (now - options.lastSeenAt.getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays > 21) score -= 0.35;
    else if (ageDays > 14) score -= 0.2;
    else if (ageDays > 7) score -= 0.1;
  }
  if (options.applicationUrl === null) score -= 0.25;
  return bounded(score);
}

/** How much of the decision can be made from known fields. Unknown stays unknown. */
export function computeDataConfidence(job: ConfidenceInput): number {
  const signals = [
    Boolean(job.description && job.description.length >= 80),
    Boolean(job.location || (job.countryCodes && job.countryCodes.length > 0)),
    job.salaryMin != null || job.salaryMax != null,
    Boolean(job.employmentType),
    Boolean(job.seniority),
    Boolean(job.publishedAt),
    Boolean(job.applicationUrl),
    Boolean(job.industry || job.category),
  ];
  const known = signals.filter(Boolean).length;
  // A complete listing is not automatically trustworthy; cap the baseline at
  // 0.9 so confidence never reads as certainty.
  return bounded(0.25 + (known / signals.length) * 0.65);
}

export function computeConfidences(job: ConfidenceInput & { lastSeenAt?: Date | null }): JobConfidences {
  return {
    listingQuality: computeListingQuality(job),
    sourceConfidence: computeSourceConfidence(job.source, {
      lastSeenAt: job.lastSeenAt,
      applicationUrl: job.applicationUrl,
    }),
    dataConfidence: computeDataConfidence(job),
  };
}

/** Fit remains the main signal; quality and confidence break near-ties. */
export function compositeRankingScore(fitScore: number, confidences: JobConfidences) {
  return Math.round((
    fitScore * 0.7 +
    confidences.listingQuality * 100 * 0.12 +
    confidences.sourceConfidence * 100 * 0.1 +
    confidences.dataConfidence * 100 * 0.08
  ) * 10) / 10;
}
