import { sanitizeArray, sanitizeText, sanitizeUrl } from './sanitize';
import { normalizeJobCategory, normalizeSeniorityValue } from './job-discovery/categories';
import { normalizeEmploymentType } from './job-discovery/location';
import type { CompanyProfile, Contact, JobRequirements } from '@/types';

export const EMPTY_REQUIREMENTS: JobRequirements = {
  mustHave: [],
  niceToHave: [],
  responsibilities: [],
  qualifications: [],
  benefits: [],
};

export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  website: '',
  linkedinUrl: '',
  size: '',
  industry: '',
  description: '',
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown, maxItems = 15) {
  return sanitizeArray(Array.isArray(value) ? value : [], maxItems);
}

export function sanitizeRequirements(value: unknown): JobRequirements {
  const record = asRecord(value);
  return {
    mustHave: stringList(record.mustHave),
    niceToHave: stringList(record.niceToHave),
    responsibilities: stringList(record.responsibilities),
    qualifications: stringList(record.qualifications),
    benefits: stringList(record.benefits),
  };
}

export function sanitizeCompanyProfile(value: unknown): CompanyProfile {
  const record = asRecord(value);
  return {
    website: sanitizeUrl(record.website),
    linkedinUrl: sanitizeUrl(record.linkedinUrl),
    size: sanitizeText(record.size, 60),
    industry: sanitizeText(record.industry, 120),
    description: sanitizeText(record.description, 2_000),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function sanitizeContacts(value: unknown): Contact[] {
  if (!Array.isArray(value)) return [];
  const contacts: Contact[] = [];
  const seen = new Set<string>();

  for (const raw of value.slice(0, 20)) {
    const record = asRecord(raw);
    const name = sanitizeText(record.name, 120);
    const email = sanitizeText(record.email, 200).toLowerCase();
    if (!name) continue;
    if (email && !EMAIL_PATTERN.test(email)) continue;
    const key = `${name.toLowerCase()}|${email}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const id = sanitizeText(record.id, 64) || crypto.randomUUID();
    contacts.push({
      id,
      name,
      company: sanitizeText(record.company, 120),
      title: sanitizeText(record.title, 120),
      relationshipType: sanitizeText(record.relationshipType, 60).toUpperCase() || 'RECRUITER',
      email: email || undefined,
      phone: sanitizeText(record.phone, 40) || undefined,
      linkedinUrl: sanitizeUrl(record.linkedinUrl) || undefined,
      outreachDate: sanitizeText(record.outreachDate, 20) || undefined,
      responseDate: sanitizeText(record.responseDate, 20) || undefined,
      nextFollowUp: sanitizeText(record.nextFollowUp, 20) || undefined,
      notes: sanitizeText(record.notes, 2_000) || undefined,
    });
  }

  return contacts;
}

export function sanitizeJobStructuredFields(values: {
  employmentType?: unknown;
  seniority?: unknown;
  category?: unknown;
  industry?: unknown;
  skills?: unknown;
  requirements?: unknown;
  companyProfile?: unknown;
  contacts?: unknown;
  title?: string;
}) {
  const category = normalizeJobCategory(
    sanitizeText(values.category, 80),
    values.title,
    Array.isArray(values.skills) ? values.skills.map(String) : [],
  );
  const seniority = normalizeSeniorityValue(sanitizeText(values.seniority, 40), values.title);
  const employmentType = normalizeEmploymentType(sanitizeText(values.employmentType, 40)) ?? '';

  return {
    employmentType,
    seniority,
    category,
    industry: sanitizeText(values.industry, 120),
    skills: stringList(values.skills, 25),
    requirements: sanitizeRequirements(values.requirements),
    companyProfile: sanitizeCompanyProfile(values.companyProfile),
    contacts: sanitizeContacts(values.contacts),
  };
}
