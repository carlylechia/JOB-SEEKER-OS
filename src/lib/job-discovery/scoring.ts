import type { ScoreFields, UserPreferences } from '@/types';
import { calculateCandidateFitScore, calculateFitTier } from '@/lib/scoring';
import { normalizeTitle, titleMatchesAny } from '@/lib/preferences';

export type ExternalJobForScoring = {
  title: string;
  location: string | null;
  remoteType: string | null;
  workArrangement?: string | null;
  countryCodes?: string[];
  locationRestrictions?: string[];
  timezoneRestrictions?: number[];
  employmentType?: string | null;
  seniority?: string | null;
  industry?: string | null;
  category?: string | null;
  visaSponsorship?: string | null;
  eligibilityRegion?: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  salaryPeriod?: string | null;
  description?: string | null;
  publishedAt?: Date | null;
  applicationUrl?: string | null;
  canonicalUrl?: string | null;
};

const SENIOR_KEYWORDS = ['senior', 'sr', 'lead', 'principal', 'staff', 'architect', 'head of', 'director'];
const ENTRY_KEYWORDS = ['junior', 'jr', 'associate', 'entry level', 'graduate', 'intern'];

const REGION_PATTERNS = {
  US: [/\bunited states\b/i, /\busa\b/i, /\bu\.s\.a?\b/i, /\bnorth america\b/i, /\bcanada\b/i],
  EU: [/\beurope\b/i, /\beuropean union\b/i, /\bemea\b/i, /\buk\b/i, /\bunited kingdom\b/i],
  AFRICA: [/\bafrica\b/i, /\bnigeria\b/i, /\bkenya\b/i, /\bghana\b/i, /\bsouth africa\b/i],
  WORLDWIDE: [/\bworldwide\b/i, /\bglobal\b/i, /\banywhere\b/i, /\binternational\b/i],
  FLEXIBLE: [],
} as const;

function normalizedWords(value: string) {
  return normalizeTitle(value).split(' ').filter((word) => word.length > 1);
}

function seniorityScore(title: string, level: UserPreferences['targetLevel'], explicitSeniority?: string | null) {
  const words = normalizedWords(`${title} ${explicitSeniority ?? ''}`);
  const isSenior = SENIOR_KEYWORDS.some((word) => words.includes(word));
  const isEntry = ENTRY_KEYWORDS.some((word) => words.includes(word));
  if (level === 'FLEXIBLE') return 3;
  if (level === 'SENIOR') return isSenior ? 5 : isEntry ? 1 : 3;
  if (level === 'ENTRY') return isEntry ? 5 : isSenior ? 1 : 3;
  return !isSenior && !isEntry ? 5 : 2;
}

function roleScore(title: string, preferences: UserPreferences) {
  const targets = [...(preferences.targetRoles ?? []), ...(preferences.preferredTitles ?? [])]
    .map((value) => value.trim())
    .filter(Boolean);
  if (targets.length === 0) return 3;
  if (titleMatchesAny(title, targets)) return 5;

  const titleWords = new Set(normalizedWords(title));
  const bestCoverage = Math.max(
    0,
    ...targets.map((target) => {
      const targetWords = normalizedWords(target);
      if (targetWords.length === 0) return 0;
      return targetWords.filter((word) => titleWords.has(word)).length / targetWords.length;
    }),
  );
  return bestCoverage >= 0.6 ? 4 : bestCoverage >= 0.3 ? 3 : bestCoverage > 0 ? 2 : 1;
}

function skillMatchScore(jobText: string, skills: string[]) {
  if (skills.length === 0) return 3;
  if (!jobText.trim()) return 2;
  const normalizedText = ` ${normalizeTitle(jobText)} `;
  const matched = skills.filter((skill) => {
    const normalizedSkill = normalizeTitle(skill);
    return normalizedSkill.length > 0 && normalizedText.includes(` ${normalizedSkill} `);
  }).length;
  const coverage = matched / skills.length;
  return Math.min(5, 1 + Math.round(coverage * 4));
}

function domainRelevanceScore(job: ExternalJobForScoring, preferences: UserPreferences) {
  const industries = (preferences.preferredIndustries ?? []).map((value) => value.toLowerCase()).filter(Boolean);
  const jobIndustry = `${job.industry ?? ''} ${job.category ?? ''}`.toLowerCase();
  if (industries.length > 0 && jobIndustry.trim()) {
    if (industries.some((industry) => jobIndustry.includes(industry) || industry.includes(jobIndustry.trim()))) {
      return 5;
    }
  }
  return skillMatchScore(`${job.title} ${job.description ?? ''}`, preferences.preferredStack ?? []);
}

function geographyScore(job: ExternalJobForScoring, preferences: UserPreferences) {
  const locationText = `${job.location ?? ''} ${job.eligibilityRegion ?? ''} ${job.remoteType ?? ''} ${job.workArrangement ?? ''}`;
  const remote = /remote|distributed|work from home/i.test(locationText);
  if (preferences.remoteOnly && !remote) return 1;

  const selectedCountries = (preferences.workCountries ?? []).map((code) => code.toUpperCase()).filter(Boolean);
  const allowedCountries = [...new Set([
    ...(job.locationRestrictions ?? []).map((code) => code.toUpperCase()),
    ...(job.countryCodes ?? []).map((code) => code.toUpperCase()),
  ].filter(Boolean))];
  if (selectedCountries.length > 0) {
    if (allowedCountries.length === 0) return 3;
    if (allowedCountries.some((code) => selectedCountries.includes(code))) return 5;
    return remote ? 2 : 1;
  }

  const selectedRegions = (preferences.workRegions ?? []).filter((region) => region !== 'FLEXIBLE');
  if (selectedRegions.includes('WORLDWIDE')) return 5;
  if (selectedRegions.length === 0) return 3;
  if (selectedRegions.some((region) => REGION_PATTERNS[region].some((pattern) => pattern.test(locationText)))) {
    return 5;
  }
  if (remote && !job.location && !job.eligibilityRegion) return 3;
  return remote ? 2 : 1;
}

function timezoneOffsetHours(timeZone: string, date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!match) return name === 'GMT' ? 0 : null;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? 0);
    return sign * (hours + minutes / 60);
  } catch {
    return null;
  }
}

function timezoneScore(job: ExternalJobForScoring, preferences: UserPreferences) {
  if (!job.timezoneRestrictions || job.timezoneRestrictions.length === 0) return 3;
  const userOffset = timezoneOffsetHours(preferences.timezone || 'UTC');
  if (userOffset === null) return 3;
  const distance = Math.min(...job.timezoneRestrictions.map((offset) => Math.abs(offset - userOffset)));
  const tolerance = Math.max(0, preferences.timezoneToleranceHours);
  if (distance <= tolerance) return 5;
  if (distance <= tolerance + 4) return 3;
  return 1;
}

function monthlySalary(value: number | null, period: string | null | undefined) {
  if (value == null) return null;
  const normalized = (period ?? 'annual').toLowerCase();
  if (normalized === 'hour' || normalized === 'hourly') return (value * 2080) / 12;
  if (normalized === 'week' || normalized === 'weekly') return (value * 52) / 12;
  if (normalized === 'month' || normalized === 'monthly') return value;
  return value / 12;
}

function compensationScore(job: ExternalJobForScoring, preferences: UserPreferences) {
  const hasSalary = job.salaryMin != null || job.salaryMax != null;
  const hasSalaryPreferences = preferences.salaryMin > 0 || preferences.salaryTarget > 0;
  if (!hasSalary || !hasSalaryPreferences) return 3;
  if (job.currency && job.currency !== 'USD') return 3; // never invent an FX conversion
  const lowest = monthlySalary(job.salaryMin ?? job.salaryMax, job.salaryPeriod);
  const highest = monthlySalary(job.salaryMax ?? job.salaryMin, job.salaryPeriod);
  if (lowest == null || highest == null) return 3;
  if (highest < preferences.salaryMin) return 1;
  if (preferences.salaryTarget > 0 && lowest >= preferences.salaryTarget) return 5;
  if (preferences.salaryMin > 0 && lowest < preferences.salaryMin) return 2;
  return 4;
}

function signalQuality(job: ExternalJobForScoring) {
  let score = 1;
  if (job.description && job.description.trim().length >= 300) score += 2;
  else if (job.description?.trim()) score += 1;
  if (job.publishedAt) {
    const ageDays = Math.max(0, (Date.now() - job.publishedAt.getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays <= 3) score += 2;
    else if (ageDays <= 7) score += 1;
  }
  if (job.applicationUrl) score += 1;
  return Math.min(5, score);
}

export function computeScoreFields(job: ExternalJobForScoring, preferences: UserPreferences) {
  const description = job.description ?? '';
  const jobText = `${job.title} ${description}`;
  const skills = [...new Set([...(preferences.mustHaveTech ?? []), ...(preferences.preferredStack ?? [])].map((skill) => skill.trim()).filter(Boolean))];
  const postedWithinThirtyDays = job.publishedAt
    ? Date.now() - job.publishedAt.getTime() <= 30 * 24 * 60 * 60 * 1000
    : null;

  const score: ScoreFields = {
    coreStackMatch: skillMatchScore(jobText, skills),
    roleAlignment: roleScore(job.title, preferences),
    seniorityFit: seniorityScore(job.title, preferences.targetLevel, job.seniority),
    geographyEligibility: geographyScore(job, preferences),
    timezoneCompatibility: timezoneScore(job, preferences),
    compensationFit: compensationScore(job, preferences),
    domainRelevance: domainRelevanceScore(job, preferences),
    applicationFriction: job.applicationUrl ? 4 : job.canonicalUrl ? 3 : 1,
    signalQuality: signalQuality(job),
  };

  return {
    score,
    matchedSkills: skills.filter((skill) =>
      normalizeTitle(skill).length > 0 &&
      ` ${normalizeTitle(jobText)} `.includes(` ${normalizeTitle(skill)} `),
    ),
    postedWithinThirtyDays,
  };
}

export function scoreExternalJob(job: ExternalJobForScoring, preferences: UserPreferences) {
  const scoreFields = computeScoreFields(job, preferences);
  const fitScore = calculateCandidateFitScore({
    title: job.title,
    notes: job.description ?? '',
    location: job.location ?? '',
    eligibilityRegion: job.eligibilityRegion ?? '',
    remoteType: job.remoteType ?? '',
    timezoneRequirement: job.timezoneRestrictions?.length ? job.timezoneRestrictions.join(',') : '',
    salaryMin: job.salaryMin ?? 0,
    salaryMax: job.salaryMax ?? 0,
    score: scoreFields.score,
  }, preferences);
  return { scoreFields, fitScore, fitTier: calculateFitTier(fitScore) };
}

export function buildMatchExplanation(
  job: ExternalJobForScoring,
  preferences: UserPreferences,
  scoreFields: ReturnType<typeof computeScoreFields>,
  fitScore: number,
) {
  const reasons = [fitScore >= 80 ? 'Strong match across your selected preferences' : 'Ranked against your job preferences'];
  if (scoreFields.matchedSkills.length > 0) {
    reasons.push(`Matches ${scoreFields.matchedSkills.slice(0, 3).join(', ')}`);
  }
  if (job.industry && (preferences.preferredIndustries ?? []).length > 0) {
    const jobIndustry = job.industry.toLowerCase();
    if ((preferences.preferredIndustries ?? []).some((industry) => jobIndustry.includes(industry.toLowerCase()))) {
      reasons.push(`Industry matches ${job.industry}`);
    }
  }
  if (preferences.remoteOnly && /remote|distributed|work from home/i.test(`${job.remoteType ?? ''} ${job.workArrangement ?? ''} ${job.location ?? ''}`)) {
    reasons.push('Remote work matches your preference');
  }
  if (job.publishedAt && scoreFields.postedWithinThirtyDays) {
    const ageDays = Math.max(0, (Date.now() - job.publishedAt.getTime()) / (24 * 60 * 60 * 1000));
    reasons.push(ageDays <= 7 ? 'Posted within the last week' : 'Recently posted');
  }

  const gaps: string[] = [];
  if (!job.description?.trim()) gaps.push('The posting has limited description details');
  if (preferences.salaryMin > 0 && job.salaryMin == null && job.salaryMax == null) gaps.push('Salary was not provided');
  if (preferences.visaSponsorshipRequired && job.visaSponsorship !== 'YES') {
    gaps.push('Visa sponsorship is not stated');
  }
  if ((preferences.workCountries ?? []).length > 0 && (job.countryCodes?.length ?? 0) === 0 && (job.locationRestrictions?.length ?? 0) === 0) {
    gaps.push('The work location could not be verified');
  }
  if (scoreFields.matchedSkills.length === 0 && (preferences.preferredStack ?? []).length > 0) {
    gaps.push('Few of your listed skills were found in the posting');
  }
  return { reasons, gaps };
}
