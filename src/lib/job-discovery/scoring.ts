import type { ExternalJob } from '@prisma/client';
import type { UserPreferences } from '@/types';
import { calculateFitScore, calculateFitTier } from '@/lib/scoring';
import { titleMatchesAny } from '@/lib/preferences';

function includesAnyCI(text: string, needles: string[]) {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

const SENIOR_KEYWORDS = ['senior', 'sr.', 'sr ', 'lead', 'principal', 'staff', 'architect', 'head of', 'director'];
const ENTRY_KEYWORDS = ['junior', 'jr.', 'jr ', 'associate', 'entry level', 'entry-level', 'graduate', 'intern'];

function inferSeniorityScore(titleLower: string, targetLevel: UserPreferences['targetLevel']): number {
  const isSenior = SENIOR_KEYWORDS.some((kw) => titleLower.includes(kw));
  const isEntry = ENTRY_KEYWORDS.some((kw) => titleLower.includes(kw));
  const isMid = !isSenior && !isEntry;
  if (targetLevel === 'FLEXIBLE') return 3;
  if (targetLevel === 'SENIOR') return isSenior ? 4 : isEntry ? 1 : 3;
  if (targetLevel === 'ENTRY') return isEntry ? 4 : isSenior ? 1 : 3;
  return isMid ? 4 : isSenior ? 2 : 3;
}

const REGION_KEYWORDS: Record<string, string[]> = {
  US: ['us', 'usa', 'united states', 'north america'],
  EU: ['eu', 'europe', 'european union', 'emea', 'uk', 'united kingdom'],
  AFRICA: ['africa', 'african', 'nigeria', 'kenya', 'ghana', 'south africa'],
  WORLDWIDE: ['worldwide', 'global', 'anywhere', 'international'],
  FLEXIBLE: ['flexible'],
};

export function computeScoreFields(job: { title: string; location: string | null; remoteType: string | null; eligibilityRegion: string | null; salaryMin: number | null; salaryMax: number | null; currency: string | null; notes?: string | null }, prefs: UserPreferences) {
  const titleLower = job.title.toLowerCase();
  const roleSources = [...prefs.targetRoles, ...prefs.preferredTitles].filter(Boolean);
  const roleAlignment = roleSources.length ? (titleMatchesAny(job.title, roleSources) ? 4 : 2) : 3;

  const locationText = `${job.location ?? ''} ${job.eligibilityRegion ?? ''} ${job.remoteType ?? ''}`;
  const isRemote = /remote/i.test(locationText);
  const userWorkRegionKeywords = prefs.workRegions.flatMap((r) => REGION_KEYWORDS[r] ?? [r.toLowerCase()]);
  const jobMatchesUserRegion =
    prefs.workRegions.includes('WORLDWIDE' as any) ||
    (userWorkRegionKeywords.length > 0 && includesAnyCI(locationText, userWorkRegionKeywords)) ||
    (isRemote && prefs.workRegions.length > 0);
  let geographyEligibility = jobMatchesUserRegion ? 4 : 3;
  if (prefs.remoteOnly && !isRemote) geographyEligibility = Math.max(1, geographyEligibility - 2);

  const timezoneCompatibility = 3; // neutral unless requirement present

  const hasSalary = job.salaryMin != null || job.salaryMax != null;
  const hasPrefs = prefs.salaryMin > 0 || prefs.salaryTarget > 0;
  let compensationFit = 3;
  if (hasSalary && hasPrefs) {
    const jobRef = job.salaryMax ?? job.salaryMin ?? 0;
    const userMin = prefs.salaryMin;
    const userTarget = prefs.salaryTarget > 0 ? prefs.salaryTarget : userMin * 1.25;
    if (jobRef < userMin) compensationFit = 1;
    else if (jobRef >= userTarget) compensationFit = 5;
    else {
      const ratio = userTarget === userMin ? 1 : (jobRef - userMin) / (userTarget - userMin);
      compensationFit = Math.round(2 + ratio * 2);
    }
  }

  return {
    coreStackMatch: 3,
    roleAlignment,
    seniorityFit: inferSeniorityScore(titleLower, prefs.targetLevel),
    geographyEligibility,
    timezoneCompatibility,
    compensationFit,
    domainRelevance: 3,
    applicationFriction: 3,
    signalQuality: 3,
  };
}

export function scoreExternalJob(job: { title: string; location: string | null; remoteType: string | null; eligibilityRegion: string | null; salaryMin: number | null; salaryMax: number | null; currency: string | null }, prefs: UserPreferences) {
  const scoreFields = computeScoreFields({ ...job, notes: null }, prefs) as any;
  const synthetic = { title: job.title ?? '', score: scoreFields } as any;
  const fitScore = calculateFitScore(synthetic, prefs);
  const fitTier = calculateFitTier(fitScore);
  return { scoreFields, fitScore, fitTier };
}
