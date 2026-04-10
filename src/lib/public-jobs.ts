import { prisma } from '@/lib/prisma';
import { buildStoredJobPayload, getUserPreferences } from '@/lib/db-helpers';
import { titleMatchesAny } from '@/lib/preferences';
import { SeniorityLevel, UserPreferences } from '@/types';

export type PublicJobsQueryOptions = {
  q?: string;
  take?: number;
};

export type PublicJobRecord = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string | null;
  createdAt: Date;
  notes: string | null;
};

export function getPublicJobsSinceDate(days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

export function normalizePublicJobsSearchQuery(value?: string | null) {
  return value?.trim() ?? '';
}

export function clampPublicJobsTake(value?: number, min = 1, max = 40) {
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(Number(value), min), max);
}

export async function getPublicJobs(options: PublicJobsQueryOptions = {}): Promise<PublicJobRecord[]> {
  const q = normalizePublicJobsSearchQuery(options.q);
  const take = clampPublicJobsTake(options.take);

  return prisma.jobLead.findMany({
    where: {
      createdAt: {
        gte: getPublicJobsSinceDate(30),
      },
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { company: { contains: q, mode: 'insensitive' } },
              { location: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take,
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      remoteType: true,
      createdAt: true,
      notes: true,
    },
  });
}

export function formatPublicJobAge(date: Date) {
  const now = Date.now();
  const diffDays = Math.max(1, Math.floor((now - new Date(date).getTime()) / (1000 * 60 * 60 * 24)));

  if (diffDays === 1) return 'Added 1 day ago';
  if (diffDays < 7) return `Added ${diffDays} days ago`;

  const weeks = Math.floor(diffDays / 7);
  if (weeks === 1) return 'Added 1 week ago';
  return `Added ${weeks} weeks ago`;
}

export function formatPublicJobLocation(remoteType: string | null, location: string | null) {
  if (remoteType && location) return `${remoteType} · ${location}`;
  if (remoteType) return remoteType;
  if (location) return location;
  return 'Location not specified';
}

type PublicJobSource = {
  title: string;
  location: string | null;
  remoteType: string | null;
  timezoneRequirement: string | null;
  eligibilityRegion: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  notes: string | null;
};

function includesAnyCI(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

const SENIOR_KEYWORDS = ['senior', 'sr.', 'sr ', 'lead', 'principal', 'staff', 'architect', 'head of', 'director'];
const ENTRY_KEYWORDS = ['junior', 'jr.', 'jr ', 'associate', 'entry level', 'entry-level', 'graduate', 'intern'];

function inferSeniorityScore(titleLower: string, targetLevel: SeniorityLevel): number {
  const isSenior = SENIOR_KEYWORDS.some((kw) => titleLower.includes(kw));
  const isEntry = ENTRY_KEYWORDS.some((kw) => titleLower.includes(kw));
  const isMid = !isSenior && !isEntry;

  if (targetLevel === 'FLEXIBLE') return 3;
  if (targetLevel === 'SENIOR') return isSenior ? 4 : isEntry ? 1 : 3;
  if (targetLevel === 'ENTRY') return isEntry ? 4 : isSenior ? 1 : 3;
  // MID: mid-level title is ideal; slight penalty for senior, light one for entry
  return isMid ? 4 : isSenior ? 2 : 3;
}

const REGION_KEYWORDS: Record<string, string[]> = {
  US: ['us', 'usa', 'united states', 'north america', 'us only', 'us-based'],
  EU: ['eu', 'europe', 'european union', 'emea', 'uk', 'united kingdom'],
  AFRICA: ['africa', 'african', 'nigeria', 'kenya', 'ghana', 'south africa'],
  WORLDWIDE: ['worldwide', 'global', 'anywhere', 'international'],
  FLEXIBLE: ['flexible'],
};

function inferGeographyScore(source: PublicJobSource, preferences: UserPreferences): number {
  const locationText = `${source.location ?? ''} ${source.eligibilityRegion ?? ''} ${source.remoteType ?? ''} ${source.notes ?? ''}`;
  const isRemote = /remote/i.test(locationText);

  // If the job explicitly lists a region and user has workRegion preferences, check overlap
  const userWorkRegionKeywords = preferences.workRegions.flatMap(
    (r) => REGION_KEYWORDS[r] ?? [r.toLowerCase()],
  );

  const jobMatchesUserRegion =
    preferences.workRegions.includes('WORLDWIDE') ||
    (userWorkRegionKeywords.length > 0 && includesAnyCI(locationText, userWorkRegionKeywords)) ||
    (isRemote && preferences.workRegions.length > 0);

  let score = jobMatchesUserRegion ? 4 : 3;

  // Penalty if user wants remote-only but job isn't remote
  if (preferences.remoteOnly && !isRemote) {
    score = Math.max(1, score - 2);
  }

  return score;
}

function inferTimezoneScore(source: PublicJobSource, preferences: UserPreferences): number {
  // No requirement = flexible, treat as compatible
  if (!source.timezoneRequirement?.trim()) return 4;

  if (preferences.timezoneMatches.length === 0) return 3;

  const tzText = `${source.timezoneRequirement} ${source.notes ?? ''}`;
  return includesAnyCI(tzText, preferences.timezoneMatches) ? 4 : 2;
}

function inferCompensationScore(source: PublicJobSource, preferences: UserPreferences): number {
  const hasSalary = source.salaryMin != null || source.salaryMax != null;
  const hasPrefs = preferences.salaryMin > 0 || preferences.salaryTarget > 0;

  if (!hasSalary || !hasPrefs) return 3;

  const jobRef = source.salaryMax ?? source.salaryMin ?? 0;
  const userMin = preferences.salaryMin;
  const userTarget = preferences.salaryTarget > 0 ? preferences.salaryTarget : userMin * 1.25;

  if (jobRef < userMin) return 1;
  if (jobRef >= userTarget) return 5;

  // Scale linearly between min (→ 2) and target (→ 4)
  const ratio = (jobRef - userMin) / (userTarget - userMin);
  return Math.round(2 + ratio * 2);
}

/**
 * Infer initial score components from available public job metadata and user
 * preferences. These replace the naive all-3 defaults so that fit scoring is
 * immediately meaningful without the user manually filling every slider.
 *
 * coreStackMatch / domainRelevance / applicationFriction / signalQuality are
 * kept at 3 (neutral) because they require full job-posting text to assess.
 */
function inferScoreComponents(source: PublicJobSource, preferences: UserPreferences) {
  const titleLower = source.title.toLowerCase();

  // roleAlignment: check job title against user's target/preferred titles
  const roleSources = [...preferences.targetRoles, ...preferences.preferredTitles].filter(Boolean);
  const roleAlignment = roleSources.length
    ? (titleMatchesAny(source.title, roleSources) ? 4 : 2)
    : 3;

  return {
    roleAlignment,
    seniorityFit: inferSeniorityScore(titleLower, preferences.targetLevel),
    geographyEligibility: inferGeographyScore(source, preferences),
    timezoneCompatibility: inferTimezoneScore(source, preferences),
    compensationFit: inferCompensationScore(source, preferences),
    // Cannot reliably infer from public job metadata alone
    coreStackMatch: 3,
    domainRelevance: 3,
    applicationFriction: 3,
    signalQuality: 3,
  };
}

/**
 * Clone a public job (no userId) into a specific user's workspace.
 * Returns the new job's ID, or the existing job's ID if it's a duplicate.
 * Throws if the source job is not found.
 */
export async function clonePublicJobForUser(
  sourceJobId: string,
  userId: string,
): Promise<string> {
  const sourceJob = await prisma.jobLead.findFirst({
    where: { id: sourceJobId },
  });

  if (!sourceJob) {
    throw new Error(`Public job not found: ${sourceJobId}`);
  }

  // Deduplication: check by jobUrl OR company+title
  const existing = await prisma.jobLead.findFirst({
    where: {
      userId,
      OR: [
        ...(sourceJob.jobUrl ? [{ jobUrl: sourceJob.jobUrl }] : []),
        { company: sourceJob.company, title: sourceJob.title },
      ],
    },
  });

  if (existing) {
    return existing.id;
  }

  const preferences = await getUserPreferences(userId);

  // Infer score components from job metadata + user preferences so that fit
  // scoring is immediately meaningful rather than uniformly neutral.
  const inferred = inferScoreComponents(
    {
      title: sourceJob.title,
      location: sourceJob.location,
      remoteType: sourceJob.remoteType,
      timezoneRequirement: sourceJob.timezoneRequirement,
      eligibilityRegion: sourceJob.eligibilityRegion,
      salaryMin: sourceJob.salaryMin,
      salaryMax: sourceJob.salaryMax,
      notes: sourceJob.notes,
    },
    preferences,
  );

  const jobPayload = buildStoredJobPayload(
    {
      company: sourceJob.company,
      title: sourceJob.title,
      source: sourceJob.source,
      jobUrl: sourceJob.jobUrl,
      location: sourceJob.location,
      remoteType: sourceJob.remoteType,
      timezoneRequirement: sourceJob.timezoneRequirement,
      eligibilityRegion: sourceJob.eligibilityRegion,
      salaryMin: sourceJob.salaryMin,
      salaryMax: sourceJob.salaryMax,
      currency: sourceJob.currency,
      notes: sourceJob.notes,
      status: 'LEAD',
      dateFound: new Date().toISOString().slice(0, 10),
      ...inferred,
    },
    preferences,
  );

  const cloned = await prisma.jobLead.create({
    data: {
      userId,
      company: jobPayload.company,
      title: jobPayload.title,
      source: jobPayload.source,
      jobUrl: jobPayload.jobUrl ?? null,
      location: jobPayload.location,
      remoteType: jobPayload.remoteType,
      timezoneRequirement: jobPayload.timezoneRequirement,
      eligibilityRegion: jobPayload.eligibilityRegion,
      salaryMin: jobPayload.salaryMin ?? null,
      salaryMax: jobPayload.salaryMax ?? null,
      currency: jobPayload.currency,
      notes: jobPayload.notes,
      status: jobPayload.status,
      dateFound: new Date(jobPayload.dateFound),
      dateApplied: jobPayload.dateApplied ? new Date(jobPayload.dateApplied) : null,
      nextFollowUp: jobPayload.nextFollowUp ? new Date(jobPayload.nextFollowUp) : null,
      priorityFlag: jobPayload.priorityFlag,
      score: jobPayload.score,
      checklist: jobPayload.checklist,
      contacts: jobPayload.contacts,
      interviews: jobPayload.interviews,
      prepPack: jobPayload.prepPack,
    },
  });

  return cloned.id;
}
