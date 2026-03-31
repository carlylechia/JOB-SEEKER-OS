import { FitTier, JobLead, PriorityFlag, ScoreFields } from '@/types';

export const weights = {
  coreStackMatch: 25,
  roleAlignment: 15,
  seniorityFit: 15,
  geographyEligibility: 10,
  timezoneCompatibility: 10,
  compensationFit: 10,
  domainRelevance: 5,
  applicationFriction: 5,
  signalQuality: 5,
} as const;

export function calculateFitScore(score: ScoreFields): number {
  if (score.geographyEligibility === 0 || score.timezoneCompatibility === 0) return 0;

  const total = Object.entries(weights).reduce((sum, [key, weight]) => {
    const value = score[key as keyof ScoreFields];
    return sum + (value / 5) * weight;
  }, 0);

  return Math.round(total * 10) / 10;
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

export function hydrateJob(job: JobLead): JobLead {
  const fitScore = calculateFitScore(job.score);
  const fitTier = calculateFitTier(fitScore);
  const hydrated = {
    ...job,
    score: { ...job.score, fitScore, fitTier },
  };
  return { ...hydrated, priorityFlag: calculatePriority(hydrated) };
}
