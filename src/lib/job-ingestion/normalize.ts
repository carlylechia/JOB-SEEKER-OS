import { sanitizeArray, sanitizeText, sanitizeUrl } from '@/lib/sanitize';
import {
  normalizeJobCategory,
  normalizeSeniority,
  CATEGORY_LABELS,
  SENIORITY_LABELS,
} from '@/lib/job-discovery/categories';
import { annualiseSalary } from '@/lib/job-discovery/salary';
import { normalizeEmploymentType, normalizeWorkArrangement } from '@/lib/job-discovery/location';
import type { CompanyProfile, Contact, JobFormValues, JobRequirements } from '@/types';
import type { ModelIngestion } from './schema';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(value: unknown, max = 300) {
  return sanitizeText(value, max);
}

function uniqueStatements(values: string[], max = 12) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const statement = clean(value, 320);
    const key = statement.toLowerCase();
    if (!statement || seen.has(key)) continue;
    seen.add(key);
    result.push(statement);
    if (result.length >= max) break;
  }
  return result;
}

export function normalizeRequirements(model: ModelIngestion): JobRequirements {
  const groups: Record<string, string[]> = {
    MUST_HAVE: [],
    NICE_TO_HAVE: [],
    RESPONSIBILITY: [],
    QUALIFICATION: [],
    BENEFIT: [],
  };
  for (const item of model.requirements ?? []) {
    if (groups[item.kind]) groups[item.kind].push(item.text);
  }
  return {
    mustHave: uniqueStatements(groups.MUST_HAVE),
    niceToHave: uniqueStatements(groups.NICE_TO_HAVE),
    responsibilities: uniqueStatements(groups.RESPONSIBILITY),
    qualifications: uniqueStatements(groups.QUALIFICATION),
    benefits: uniqueStatements(groups.BENEFIT),
  };
}

function safeLinkedIn(value: unknown) {
  const url = sanitizeUrl(value);
  if (!url) return '';
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'linkedin.com' || host.endsWith('.linkedin.com') ? url : '';
  } catch {
    return '';
  }
}

export function normalizeModelContacts(model: ModelIngestion, company: string): Contact[] {
  const contacts: Contact[] = [];
  const seen = new Set<string>();

  for (const raw of model.contacts ?? []) {
    const name = clean(raw.name, 120);
    const email = clean(raw.email, 200).toLowerCase();
    if (!name && !EMAIL_PATTERN.test(email)) continue;
    if (email && !EMAIL_PATTERN.test(email)) continue;

    const key = `${name.toLowerCase()}|${email}`;
    if (seen.has(key)) continue;
    seen.add(key);

    contacts.push({
      id: crypto.randomUUID(),
      name: name || email.split('@')[0],
      company,
      title: clean(raw.title, 120),
      relationshipType: clean(raw.relationshipType, 60).toUpperCase() || 'RECRUITER',
      email: email || undefined,
      phone: clean(raw.phone, 40) || undefined,
      linkedinUrl: safeLinkedIn(raw.linkedinUrl) || undefined,
      notes: 'Extracted from the job posting by AI. Verify before outreach.',
    });
    if (contacts.length >= 5) break;
  }

  return contacts;
}

export function normalizeCompanyProfile(model: ModelIngestion): CompanyProfile {
  const website = sanitizeUrl(model.companyWebsite);
  const linkedinUrl = safeLinkedIn(model.companyLinkedinUrl);
  return {
    website,
    linkedinUrl,
    size: clean(model.companySize, 60),
    industry: clean(model.industry, 120),
    description: clean(model.description, 2_000),
  };
}

function normalizeSalary(model: ModelIngestion) {
  let min = typeof model.salaryMin === 'number' && Number.isFinite(model.salaryMin) ? Math.round(model.salaryMin) : null;
  let max = typeof model.salaryMax === 'number' && Number.isFinite(model.salaryMax) ? Math.round(model.salaryMax) : null;
  if (min != null && (min < 0 || min > 10_000_000)) min = null;
  if (max != null && (max < 0 || max > 10_000_000)) max = null;
  if (min != null && max != null && min > max) [min, max] = [max, min];

  const period = model.salaryPeriod ?? 'unknown';
  const annualMin = annualiseSalary(min, period);
  const annualMax = annualiseSalary(max, period);
  const currency = /^[A-Z]{3}$/.test(model.currency?.trim().toUpperCase())
    ? model.currency.trim().toUpperCase()
    : null;
  return { min: annualMin, max: annualMax, currency, period };
}

export type NormalizedIngestion = {
  prefill: Partial<JobFormValues>;
  signals: string[];
  previewText: string;
  confidence: number;
  warnings: string[];
};

/**
 * Convert model output into the exact shape the job form consumes.
 *
 * The deterministic extraction is passed in as the floor: its scoring fields
 * remain authoritative, and any field the model left blank falls back to what
 * the parser found. The model never supplies fit scores.
 */
export function normalizeModelIngestion(
  model: ModelIngestion,
  context: {
    text: string;
    jobUrl?: string;
    fallback: { prefill: Partial<JobFormValues>; signals: string[]; previewText: string };
  },
): NormalizedIngestion {
  const fallback = context.fallback.prefill;
  const title = clean(model.title, 150) || fallback.title || '';
  const company = clean(model.company, 120) || fallback.company || '';
  const description = clean(model.description, 20_000) || fallback.jobDescription || clean(context.text, 20_000);
  const category =
    model.category && model.category !== 'OTHER'
      ? model.category
      : normalizeJobCategory(title, model.industry, model.skills);
  const seniority = model.seniority !== 'UNKNOWN' ? model.seniority : normalizeSeniority(null, title);
  const remoteType =
    model.remoteType === 'Unknown'
      ? fallback.remoteType || 'Remote'
      : model.remoteType;
  const employmentType = model.employmentType === 'UNKNOWN' ? '' : normalizeEmploymentType(model.employmentType) ?? '';
  const salary = normalizeSalary(model);
  const contacts = normalizeModelContacts(model, company);
  const requirements = normalizeRequirements(model);
  const companyProfile = normalizeCompanyProfile(model);
  const skills = sanitizeArray(model.skills, 25);
  const source =
    clean(model.source, 80) ||
    (context.jobUrl ? fallback.source : '') ||
    (context.text ? 'Pasted description' : 'Screenshot');

  const requirementCount =
    requirements.mustHave.length +
    requirements.niceToHave.length +
    requirements.responsibilities.length +
    requirements.qualifications.length +
    requirements.benefits.length;

  const signals = [
    ...(fallback ? context.fallback.signals : []),
    `AI extracted ${CATEGORY_LABELS[category].toLowerCase()} role`,
    `Seniority: ${SENIORITY_LABELS[seniority]}`,
    requirementCount > 0 ? `${requirementCount} structured requirement${requirementCount === 1 ? '' : 's'}` : '',
    contacts.length > 0 ? `${contacts.length} contact${contacts.length === 1 ? '' : 's'} found` : '',
    salary.min != null || salary.max != null ? 'Salary range detected' : '',
  ].filter(Boolean);

  const warnings = uniqueStatements(model.warnings ?? [], 5);

  return {
    prefill: {
      ...fallback,
      title,
      company,
      source,
      jobUrl: context.jobUrl || sanitizeUrl(model.applicationUrl) || fallback.jobUrl || '',
      location: clean(model.location, 120) || fallback.location || '',
      remoteType,
      timezoneRequirement: clean(model.timezoneRequirement, 120) || fallback.timezoneRequirement || '',
      eligibilityRegion: clean(model.eligibilityRegion, 120) || fallback.eligibilityRegion || '',
      employmentType,
      seniority,
      category,
      industry: clean(model.industry, 120),
      skills,
      requirements,
      companyProfile,
      contacts,
      salaryMin: salary.min != null ? String(salary.min) : fallback.salaryMin || '',
      salaryMax: salary.max != null ? String(salary.max) : fallback.salaryMax || '',
      currency: salary.currency || fallback.currency || 'USD',
      jobDescription: description,
      notes: fallback.notes || '',
      status: 'LEAD',
    },
    signals,
    previewText: sanitizeText(description || context.text, 1_200),
    confidence: Math.max(0, Math.min(1, Number(model.confidence) || 0)),
    warnings,
  };
}

/** Map a validated image count and inputs to the result's source mode. */
export function ingestionSourceMode(input: {
  jobUrl?: boolean;
  description?: boolean;
  images: number;
}) {
  const hasImage = input.images > 0;
  if (hasImage) {
    if (input.jobUrl && input.description) return 'image+url+description' as const;
    if (input.jobUrl) return 'image+url' as const;
    if (input.description) return 'image+description' as const;
    return 'image' as const;
  }
  if (input.jobUrl && input.description) return 'url+description' as const;
  if (input.jobUrl) return 'url' as const;
  return 'description' as const;
}

export function remoteTypeFallback(value: string | null | undefined) {
  return normalizeWorkArrangement(value) ?? 'Remote';
}
