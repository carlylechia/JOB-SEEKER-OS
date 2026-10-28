import type { UserPreferences } from '@/types';
import { employmentTypeMatches, normalizeEmploymentType } from './location';

export type EligibilityJob = {
  status?: string | null;
  title?: string | null;
  applicationUrl?: string | null;
  canonicalUrl?: string | null;
  expiresAt?: Date | null;
  publishedAt?: Date | null;
  lastSeenAt?: Date | null;
  workArrangement?: string | null;
  remoteType?: string | null;
  location?: string | null;
  countryCodes?: string[];
  locationRestrictions?: string[];
  employmentType?: string | null;
  visaSponsorship?: string | null;
};

export type EligibilityContext = Pick<
  UserPreferences,
  'remoteOnly' | 'workCountries' | 'employmentTypes' | 'visaSponsorshipRequired'
> & {
  now?: Date;
  maxAgeDays?: number;
};

export type EligibilityCheckState = 'PASS' | 'FAIL' | 'UNKNOWN';
export type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
  checks: Record<string, EligibilityCheckState>;
};

function isRemoteWork(value: string | null | undefined) {
  return Boolean(value && /remote|distributed|work from home|wfh/i.test(value));
}

function isExplicitOnsite(value: string | null | undefined) {
  return Boolean(value && /on-?site|in[ -]person/i.test(value) && !isRemoteWork(value));
}

/**
 * Hard eligibility is intentionally conservative: a check only fails when the
 * data says the user cannot take the job. Missing or unknown data passes and
 * is reflected later in data confidence, never used as an excuse to exclude.
 */
export function checkHardEligibility(job: EligibilityJob, context: EligibilityContext): EligibilityResult {
  const now = context.now ?? new Date();
  const checks: Record<string, EligibilityCheckState> = {};
  const reasons: string[] = [];

  checks.open = job.status && job.status !== 'OPEN' ? 'FAIL' : 'PASS';
  if (checks.open === 'FAIL') reasons.push('The listing is closed');

  const hasLink = Boolean(job.applicationUrl || job.canonicalUrl);
  checks.applyLink = hasLink ? 'PASS' : 'FAIL';
  if (!hasLink) reasons.push('No application or listing URL is available');

  if (job.expiresAt) {
    const expired = job.expiresAt.getTime() < now.getTime();
    checks.notExpired = expired ? 'FAIL' : 'PASS';
    if (expired) reasons.push('The application deadline has passed');
  } else {
    checks.notExpired = 'UNKNOWN';
  }

  const maxAgeMs = (context.maxAgeDays ?? 60) * 24 * 60 * 60 * 1000;
  if (job.publishedAt) {
    const stale = now.getTime() - job.publishedAt.getTime() > maxAgeMs;
    checks.freshness = stale ? 'FAIL' : 'PASS';
    if (stale) reasons.push('The posting is older than the freshness window');
  } else {
    checks.freshness = 'UNKNOWN';
  }

  if (job.lastSeenAt) {
    const stale = now.getTime() - job.lastSeenAt.getTime() > 21 * 24 * 60 * 60 * 1000;
    checks.sourceFreshness = stale ? 'FAIL' : 'PASS';
    if (stale) reasons.push('The source has not confirmed this listing recently');
  } else {
    checks.sourceFreshness = 'UNKNOWN';
  }

  if (context.remoteOnly) {
    const onsite = isExplicitOnsite(job.workArrangement) || isExplicitOnsite(job.remoteType) ||
      (isExplicitOnsite(job.location) && !isRemoteWork(job.workArrangement) && !isRemoteWork(job.remoteType));
    checks.remote = onsite ? 'FAIL' : job.workArrangement || job.remoteType ? 'PASS' : 'UNKNOWN';
    if (onsite) reasons.push('The role is explicitly on-site and you selected remote-only');
  } else {
    checks.remote = 'PASS';
  }

  const selectedCountries = [...new Set(context.workCountries.map((code) => code.toUpperCase()).filter(Boolean))];
  const allowedCountries = [...new Set([
    ...(job.locationRestrictions ?? []).map((code) => code.toUpperCase()),
    ...(job.countryCodes ?? []).map((code) => code.toUpperCase()),
  ].filter(Boolean))];
  if (selectedCountries.length === 0) {
    checks.workCountry = 'PASS';
  } else if (allowedCountries.length === 0) {
    // Unknown country is not a reason to exclude a candidate.
    checks.workCountry = 'UNKNOWN';
  } else {
    const overlap = allowedCountries.some((code) => selectedCountries.includes(code));
    checks.workCountry = overlap ? 'PASS' : 'FAIL';
    if (!overlap) reasons.push(`The role is limited to ${allowedCountries.join(', ')}`);
  }

  if (context.employmentTypes.length === 0) {
    checks.employmentType = 'PASS';
  } else if (!normalizeEmploymentType(job.employmentType)) {
    checks.employmentType = 'UNKNOWN';
  } else {
    const matches = employmentTypeMatches(job.employmentType, context.employmentTypes);
    checks.employmentType = matches ? 'PASS' : 'FAIL';
    if (!matches) reasons.push('The employment type is not one you selected');
  }

  if (!context.visaSponsorshipRequired) {
    checks.visa = 'PASS';
  } else if (job.visaSponsorship === 'NO') {
    checks.visa = 'FAIL';
    reasons.push('The posting explicitly says visa sponsorship is unavailable');
  } else if (job.visaSponsorship === 'YES') {
    checks.visa = 'PASS';
  } else {
    checks.visa = 'UNKNOWN';
  }

  const eligible = Object.values(checks).every((state) => state !== 'FAIL');
  return { eligible, reasons, checks };
}
