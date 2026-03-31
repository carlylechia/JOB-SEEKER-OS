import { FitTier, JobLead, PriorityFlag, ScoreFields, UserPreferences } from '@/types';
import { defaultPreferences } from './preferences';

export const weights = {
  coreStackMatch: 25,
  roleAlignment: 17,
  seniorityFit: 20,
  geographyEligibility: 10,
  timezoneCompatibility: 10,
  compensationFit: 10,
  domainRelevance: 5,
  applicationFriction: 5,
  signalQuality: 5,
} as const;

function getPenaltyMultiplier(value: number, dimension: 'seniority' | 'role'): number {
  if (dimension === 'seniority') {
    return [0.35, 0.5, 0.68, 0.82, 0.93, 1][value] ?? 1;
  }

  return [0.35, 0.55, 0.72, 0.85, 0.95, 1][value] ?? 1;
}

function includesAny(text: string, needles: string[]): boolean {
  const hay = text.toLowerCase();
  return needles.some((needle) => hay.includes(needle.toLowerCase()));
}

function getPersonalizationModifier(job: JobLead, preferences: UserPreferences): number {
  let modifier = 1;
  const titleAndNotes = `${job.title} ${job.notes}`;
  const locationFields = `${job.location} ${job.eligibilityRegion} ${job.remoteType}`;
  const stackAndNotes = `${job.title} ${job.notes} ${job.prepPack?.topFitPoints ?? ''}`;
  const timezoneFields = `${job.timezoneRequirement} ${job.notes}`;

  if (preferences.targetRoles.length && includesAny(titleAndNotes, preferences.targetRoles)) modifier += 0.06;
  if (preferences.preferredTitles.length && includesAny(titleAndNotes, preferences.preferredTitles)) modifier += 0.04;
  if (preferences.preferredRegions.length && includesAny(locationFields, preferences.preferredRegions)) modifier += 0.05;
  if (preferences.workRegions.length && includesAny(timezoneFields, preferences.workRegions)) modifier += 0.04;

  const missingMustHaveCount = preferences.mustHaveTech.filter((tech) => !includesAny(stackAndNotes, [tech])).length;
  modifier -= missingMustHaveCount * 0.06;

  if (preferences.remoteOnly && !/remote/i.test(locationFields)) modifier -= 0.12;
  if (job.salaryMax && preferences.salaryMin && job.salaryMax < preferences.salaryMin) modifier -= 0.12;
  if (job.salaryMin && preferences.salaryTarget && job.salaryMin >= preferences.salaryTarget) modifier += 0.03;

  return Math.max(0.55, Math.min(1.15, modifier));
}

export function calculateBaseFitScore(score: ScoreFields): number {
  if (score.geographyEligibility === 0 || score.timezoneCompatibility === 0) return 0;

  const total = Object.entries(weights).reduce((sum, [key, weight]) => {
    const value = score[key as keyof ScoreFields];
    return sum + (value / 5) * weight;
  }, 0);

  return Math.round(total * 10) / 10;
}

export function calculateFitScore(job: JobLead, preferences: UserPreferences = defaultPreferences): number {
  if (job.score.geographyEligibility === 0 || job.score.timezoneCompatibility === 0) return 0;

  const baseScore = calculateBaseFitScore(job.score);
  const seniorityPenalty = getPenaltyMultiplier(job.score.seniorityFit, 'seniority');
  const rolePenalty = getPenaltyMultiplier(job.score.roleAlignment, 'role');
  const personalizationModifier = getPersonalizationModifier(job, preferences);
  const total = baseScore * seniorityPenalty * rolePenalty * personalizationModifier;

  return Math.round(Math.max(0, Math.min(100, total)) * 10) / 10;
}

export function calculateFitTier(score: number): FitTier {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

export function checklistCompletion(job: JobLead): number {
  const values = Object.values(job.checklist);
  const completed = values.filter(Boolean).length;
  return Math.round((completed / values.length) * 100);
}

export function calculatePriority(job: JobLead): PriorityFlag {
  const completion = checklistCompletion(job);
  const now = new Date();
  const nextFollowUp = job.nextFollowUp ? new Date(job.nextFollowUp) : null;
  const nextInterview = job.interviews[0]?.scheduledAt ? new Date(job.interviews[0].scheduledAt) : null;
  const daysToInterview = nextInterview ? (nextInterview.getTime() - now.getTime()) / (1000 * 60 * 60 * 24) : null;

  if (job.score.geographyEligibility === 0 || job.score.timezoneCompatibility === 0) return 'SKIP';
  if (daysToInterview !== null && daysToInterview <= 7 && daysToInterview >= 0) return 'INTERVIEW_SOON';
  if (nextFollowUp && nextFollowUp <= now && ['APPLIED', 'INTERVIEWING'].includes(job.status)) return 'FOLLOW_UP_DUE';
  if (job.score.fitTier === 'A' && completion >= 70 && ['LEAD', 'SAVED', 'APPLYING'].includes(job.status)) return 'APPLY_TODAY';
  if (job.score.fitTier === 'B' && completion >= 50 && ['LEAD', 'SAVED', 'APPLYING'].includes(job.status)) return 'APPLY_THIS_WEEK';
  if (['A', 'B'].includes(job.score.fitTier) && completion < 50) return 'PREPARE_ASSETS';
  if (job.score.fitTier === 'D') return 'SKIP';
  return 'MONITOR';
}

export function hydrateJob(job: JobLead, preferences: UserPreferences = defaultPreferences): JobLead {
  const fitScore = calculateFitScore(job, preferences);
  const fitTier = calculateFitTier(fitScore);
  const hydrated = {
    ...job,
    score: { ...job.score, fitScore, fitTier },
  };
  return { ...hydrated, priorityFlag: calculatePriority(hydrated) };
}
