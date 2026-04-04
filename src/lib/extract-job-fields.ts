import { JobFormValues } from '@/types';
import { sanitizeText } from './sanitize';
import { sourceLabelFromUrl } from './url';

type ExtractInput = {
  text: string;
  jobUrl?: string;
  pageTitle?: string;
};

type ExtractOutput = {
  prefill: Partial<JobFormValues>;
  signals: string[];
  previewText: string;
};

const STACK_KEYWORDS: Record<string, string[]> = {
  TypeScript: ['typescript', 'ts'],
  JavaScript: ['javascript', 'js'],
  'Next.js': ['next.js', 'nextjs'],
  React: ['react'],
  'Node.js': ['node.js', 'nodejs'],
  NestJS: ['nestjs', 'nest.js'],
  PostgreSQL: ['postgresql', 'postgres'],
  Docker: ['docker'],
  Git: ['git', 'github'],
  'CI/CD': ['ci/cd', 'cicd', 'github actions', 'pipeline'],
  AWS: ['aws'],
  GCP: ['gcp', 'google cloud'],
  Azure: ['azure'],
};

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function guessTitle(lines: string[], pageTitle?: string) {
  const candidates = [pageTitle, ...lines].map((value) => compactWhitespace(value || '')).filter(Boolean);
  return candidates.find((value) => value.length >= 6 && value.length <= 120) || '';
}

function guessCompany(text: string, title: string, jobUrl?: string) {
  const companyMatch = text.match(/(?:company|employer)\s*[:\-]\s*([^\n|]+)/i);
  if (companyMatch?.[1]) return sanitizeText(companyMatch[1], 120);

  const atMatch = title.match(/ at ([^|\-]+)/i);
  if (atMatch?.[1]) return sanitizeText(atMatch[1], 120);

  return jobUrl ? sourceLabelFromUrl(jobUrl) : '';
}

function guessLocation(text: string) {
  const locationMatch = text.match(/location\s*[:\-]\s*([^\n|]+)/i);
  if (locationMatch?.[1]) return sanitizeText(locationMatch[1], 120);
  if (/worldwide/i.test(text)) return 'Worldwide';
  if (/emea/i.test(text)) return 'EMEA';
  if (/europe/i.test(text)) return 'Europe';
  if (/africa/i.test(text)) return 'Africa';
  if (/united states|u\.s\.|usa/i.test(text)) return 'United States';
  return '';
}

function inferRemoteType(text: string) {
  if (/hybrid/i.test(text)) return 'Hybrid';
  if (/onsite|on-site|on site/i.test(text)) return 'Onsite';
  if (/remote/i.test(text)) return 'Fully Remote';
  return 'Remote';
}

function inferEligibilityRegion(text: string) {
  const regions = [] as string[];
  if (/africa/i.test(text)) regions.push('Africa');
  if (/latam/i.test(text)) regions.push('LATAM');
  if (/emea/i.test(text)) regions.push('EMEA');
  if (/eastern europe/i.test(text)) regions.push('Eastern Europe');
  if (/europe/i.test(text) && !regions.includes('EMEA')) regions.push('Europe');
  if (/worldwide|global|anywhere/i.test(text)) regions.push('Worldwide');
  return regions.join(', ');
}

function inferTimezoneRequirement(text: string) {
  const matches = [] as string[];
  if (/est|eastern time|us business hours/i.test(text)) matches.push('US hours / EST overlap');
  if (/cst|central time/i.test(text)) matches.push('CST overlap');
  if (/pst|pacific time/i.test(text)) matches.push('PST overlap');
  if (/cet|central european time/i.test(text)) matches.push('CET overlap');
  if (/gmt|utc\+?\d*/i.test(text)) matches.push('GMT / UTC overlap');
  return matches.join(', ');
}

function inferSalary(text: string) {
  const moneyRange = text.match(/(?:\$|usd\s?)(\d{1,3}(?:[,\.]\d{3})*|\d+)(?:k)?\s*(?:-|to|–)\s*(?:\$|usd\s?)?(\d{1,3}(?:[,\.]\d{3})*|\d+)(?:k)?/i);
  if (!moneyRange) return { salaryMin: '', salaryMax: '', currency: 'USD' };

  const normalize = (value: string, raw: string) => {
    const numeric = Number(value.replace(/[,\.]/g, ''));
    if (!Number.isFinite(numeric)) return '';
    return /k/i.test(raw) || numeric < 1000 ? String(numeric * 1000) : String(numeric);
  };

  return {
    salaryMin: normalize(moneyRange[1], moneyRange[0]),
    salaryMax: normalize(moneyRange[2], moneyRange[0]),
    currency: 'USD',
  };
}

function inferStack(text: string) {
  const hits = Object.entries(STACK_KEYWORDS)
    .filter(([, variants]) => variants.some((variant) => new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)))
    .map(([label]) => label);
  return hits;
}

function inferScoringSignals(text: string, title: string) {
  const seniority = /senior|staff|lead|principal/i.test(title) ? 2 : /junior|entry/i.test(title) ? 4 : 5;
  const remote = /remote/i.test(text) ? 4 : 2;
  const region = /worldwide|africa|emea|europe/i.test(text) ? 4 : 3;
  return {
    seniorityFit: seniority,
    geographyEligibility: region,
    timezoneCompatibility: /est|cst|pst|cet|gmt|utc/i.test(text) ? 4 : 3,
    applicationFriction: /video|take-home|assignment/i.test(text) ? 2 : 4,
    signalQuality: /apply now|responsibilities|requirements|about the role/i.test(text) ? 4 : 3,
    coreStackMatch: inferStack(text).length >= 3 ? 4 : 3,
    roleAlignment: /backend|full[- ]?stack|product engineer|software engineer/i.test(title) ? 4 : 3,
    compensationFit: /salary|compensation|\$|usd/i.test(text) ? 4 : 3,
    domainRelevance: 3,
  };
}

export function extractJobFields(input: ExtractInput): ExtractOutput {
  const rawText = sanitizeText(input.text, 25_000);
  const text = compactWhitespace(rawText);
  const lines = rawText.split(/\r?\n/).map((line) => sanitizeText(line, 180)).filter(Boolean).slice(0, 20);
  const title = guessTitle(lines, input.pageTitle);
  const company = guessCompany(rawText, title, input.jobUrl);
  const salary = inferSalary(rawText);
  const stack = inferStack(rawText);
  const scoring = inferScoringSignals(rawText, title);
  const signals = [
    stack.length ? `Detected stack: ${stack.join(', ')}` : '',
    inferEligibilityRegion(rawText) ? `Region clues: ${inferEligibilityRegion(rawText)}` : '',
    inferTimezoneRequirement(rawText) ? `Timezone clues: ${inferTimezoneRequirement(rawText)}` : '',
  ].filter(Boolean);

  const notes = [
    stack.length ? `Detected stack: ${stack.join(', ')}` : '',
    inferEligibilityRegion(rawText) ? `Eligibility clues: ${inferEligibilityRegion(rawText)}` : '',
    inferTimezoneRequirement(rawText) ? `Timezone clues: ${inferTimezoneRequirement(rawText)}` : '',
  ].filter(Boolean).join(' | ');

  return {
    prefill: {
      company,
      title,
      source: input.jobUrl ? sourceLabelFromUrl(input.jobUrl) : 'Pasted description',
      jobUrl: input.jobUrl || '',
      location: guessLocation(rawText),
      remoteType: inferRemoteType(rawText),
      timezoneRequirement: inferTimezoneRequirement(rawText),
      eligibilityRegion: inferEligibilityRegion(rawText),
      salaryMin: salary.salaryMin,
      salaryMax: salary.salaryMax,
      currency: salary.currency,
      notes,
      status: 'LEAD',
      ...scoring,
    },
    signals,
    previewText: sanitizeText(rawText, 1200),
  };
}
