import { createHash } from 'node:crypto';
import { isSafeExternalUrl } from '@/lib/url';
import type { NormalizedExternalJob } from './types';
import { inferCountryCodes, inferVisaSponsorship, normalizeEmploymentType, normalizeWorkArrangement } from './location';

export function normalizeCompany(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return isSafeExternalUrl(trimmed) ? trimmed : null;
}

function cleanList(values: string[] | undefined, limit = 30) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
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
  const description = job.description?.trim() || null;
  const location = job.location?.trim() || null;
  const countryCodes = job.countryCodes?.length ? job.countryCodes : inferCountryCodes(location);
  const workArrangement =
    normalizeWorkArrangement(job.workArrangement) ??
    normalizeWorkArrangement(job.remoteType) ??
    normalizeWorkArrangement(location);

  return {
    ...job,
    title: job.title.trim(),
    company: job.company.trim() || 'Unknown employer',
    location,
    countryCodes: cleanList(countryCodes, 20).map((code) => code.toUpperCase()),
    locationRestrictions: cleanList(job.locationRestrictions, 20).map((code) => code.toUpperCase()),
    timezoneRestrictions: Array.isArray(job.timezoneRestrictions)
      ? [...new Set(job.timezoneRestrictions.filter((value) => Number.isFinite(value)))].slice(0, 30)
      : [],
    remoteType: workArrangement,
    workArrangement,
    employmentType: normalizeEmploymentType(job.employmentType) ?? job.employmentType ?? null,
    seniority: job.seniority?.trim() || null,
    industry: job.industry?.trim() || null,
    category: job.category?.trim() || null,
    skills: cleanList(job.skills, 30),
    visaSponsorship: job.visaSponsorship ?? inferVisaSponsorship(description),
    description,
    currency: job.currency?.trim().toUpperCase() || 'USD',
    salaryPeriod: job.salaryPeriod?.trim().toLowerCase() || null,
    salaryMin: typeof job.salaryMin === 'number' && Number.isFinite(job.salaryMin) ? Math.round(job.salaryMin) : null,
    salaryMax: typeof job.salaryMax === 'number' && Number.isFinite(job.salaryMax) ? Math.round(job.salaryMax) : null,
    publishedAt: job.publishedAt && !isNaN(job.publishedAt.getTime()) ? job.publishedAt : null,
    expiresAt: job.expiresAt && !isNaN(job.expiresAt.getTime()) ? job.expiresAt : null,
    canonicalUrl: cleanUrl(job.canonicalUrl),
    applicationUrl: cleanUrl(job.applicationUrl),
    employerUrl: cleanUrl(job.employerUrl),
    attribution: job.attribution?.trim() || null,
    attributionUrl: cleanUrl(job.attributionUrl),
    contentFingerprint: job.contentFingerprint || fingerprintJob(job),
  };
}
