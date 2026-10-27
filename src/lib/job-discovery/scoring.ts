import type { ScoreFields, UserPreferences, WorkRegion } from '@/types';
import { calculateCandidateFitScore, calculateFitTier } from '@/lib/scoring';
import { normalizeTitle, titleMatchesAny } from '@/lib/preferences';

type ExternalJobForScoring = {
  title: string;
  location: string | null;
  remoteType: string | null;
  workArrangement?: string | null;
  eligibilityRegion?: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  description?: string | null;
  publishedAt?: Date | null;
  applicationUrl?: string | null;
  canonicalUrl?: string | null;
};

const SENIOR_KEYWORDS = ['senior', 'sr', 'lead', 'principal', 'staff', 'architect', 'head of', 'director'];
const ENTRY_KEYWORDS = ['junior', 'jr', 'associate', 'entry level', 'graduate', 'intern'];

const REGION_PATTERNS: Record<WorkRegion, RegExp[]> = {
  US: [/\bunited states\b/i, /\busa\b/i, /\bu\.s\.a?\b/i, /\bnorth america\b/i, /\bcanada\b/i],
  EU: [/\beurope\b/i, /\beuropean union\b/i, /\bemea\b/i, /\buk\b/i, /\bunited kingdom\b/i],
  AFRICA: [/\bafrica\b/i, /\bnigeria\b/i, /\bkenya\b/i, /\bghana\b/i, /\bsouth africa\b/i],
  WORLDWIDE: [/\bworldwide\b/i, /\bglobal\b/i, /\banywhere\b/i, /\binternational\b/i],
  FLEXIBLE: [],
};

function normalizedWords(value: string) {
  return normalizeTitle(value).split(' ').filter((word) => word.length > 1);
}

function seniorityScore(title: string, level: UserPreferences['targetLevel']) {
  const words = normalizedWords(title);
  const isSenior = SENIOR_KEYWORDS.some((word) => words.includes(word));
  const isEntry = ENTRY_KEYWORDS.some((word) => words.includes(word));
  if (level === 'FLEXIBLE') return 3;
  if (level === 'SENIOR') return isSenior ? 5 : isEntry ? 1 : 3;
  if (level === 'ENTRY') return isEntry ? 5 : isSenior ? 1 : 3;
  return !isSenior && !isEntry ? 5 : 2;
}

function roleScore(title: string, preferences: UserPreferences) {
  const targets = [...preferences.targetRoles, ...preferences.preferredTitles]
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

function geographyScore(job: ExternalJobForScoring, preferences: UserPreferences) {
  const locationText = `${job.location ?? ''} ${job.eligibilityRegion ?? ''} ${job.remoteType ?? ''} ${job.workArrangement ?? ''}`;
  const remote = /remote|distributed|work from home/i.test(locationText);
  if (preferences.remoteOnly && !remote) return 1;

  const selectedRegions = preferences.workRegions.filter((region) => region !== 'FLEXIBLE');
  if (selectedRegions.includes('WORLDWIDE')) return 5;
  if (selectedRegions.length === 0) return 3;
  if (selectedRegions.some((region) => REGION_PATTERNS[region].some((pattern) => pattern.test(locationText)))) {
    return 5;
  }
  if (remote && !job.location && !job.eligibilityRegion) return 3;
  return remote ? 2 : 1;
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
  const skills = [...new Set([...preferences.mustHaveTech, ...preferences.preferredStack].map((skill) => skill.trim()).filter(Boolean))];
  const hasSalary = job.salaryMin != null || job.salaryMax != null;
  const hasSalaryPreferences = preferences.salaryMin > 0 || preferences.salaryTarget > 0;
  let compensationFit = 3;

  if (hasSalary && hasSalaryPreferences && (!job.currency || job.currency === 'USD')) {
    const lowestAdvertised = job.salaryMin ?? job.salaryMax ?? 0;
    const highestAdvertised = job.salaryMax ?? job.salaryMin ?? 0;
    if (highestAdvertised < preferences.salaryMin) compensationFit = 1;
    else if (preferences.salaryTarget > 0 && lowestAdvertised >= preferences.salaryTarget) compensationFit = 5;
    else if (preferences.salaryMin > 0 && lowestAdvertised < preferences.salaryMin) compensationFit = 2;
    else compensationFit = 4;
  }

  const postedWithinThirtyDays = job.publishedAt
    ? Date.now() - job.publishedAt.getTime() <= 30 * 24 * 60 * 60 * 1000
    : null;

  const score: ScoreFields = {
    coreStackMatch: skillMatchScore(jobText, skills),
    roleAlignment: roleScore(job.title, preferences),
    seniorityFit: seniorityScore(job.title, preferences.targetLevel),
    geographyEligibility: geographyScore(job, preferences),
    timezoneCompatibility: 3,
    compensationFit,
    domainRelevance: skillMatchScore(description, preferences.preferredStack),
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
    timezoneRequirement: '',
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
  if (scoreFields.matchedSkills.length === 0 && preferences.preferredStack.length > 0) {
    gaps.push('Few of your listed skills were found in the posting');
  }
  return { reasons, gaps };
}
