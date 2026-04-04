import { prisma } from './prisma';
import { demoJobs, demoTemplates } from './demo-data';
import { defaultPreferences } from './preferences';
import { JobLead, JobFormValues, Template, UserPreferences } from '@/types';
import { calculateFitScore, calculateFitTier, calculatePriority } from './scoring';

export type DbJob = {
  id: string;
  company: string;
  title: string;
  source: string | null;
  jobUrl: string | null;
  location: string | null;
  remoteType: string | null;
  timezoneRequirement: string | null;
  eligibilityRegion: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  notes: string | null;
  status: string;
  dateFound: Date;
  dateApplied: Date | null;
  nextFollowUp: Date | null;
  priorityFlag: string;
  score: unknown;
  checklist: unknown;
  contacts: unknown;
  interviews: unknown;
  prepPack: unknown;
};

function toDateString(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

export function mapDbJob(job: DbJob): JobLead {
  return {
    id: job.id,
    company: job.company,
    title: job.title,
    source: job.source || '',
    jobUrl: job.jobUrl || '',
    location: job.location || '',
    remoteType: job.remoteType || '',
    timezoneRequirement: job.timezoneRequirement || '',
    eligibilityRegion: job.eligibilityRegion || '',
    salaryMin: job.salaryMin ?? undefined,
    salaryMax: job.salaryMax ?? undefined,
    currency: job.currency || 'USD',
    notes: job.notes || '',
    status: job.status as JobLead['status'],
    dateFound: toDateString(job.dateFound) || new Date().toISOString().slice(0, 10),
    dateApplied: toDateString(job.dateApplied),
    nextFollowUp: toDateString(job.nextFollowUp),
    priorityFlag: job.priorityFlag as JobLead['priorityFlag'],
    score: job.score as JobLead['score'],
    checklist: job.checklist as JobLead['checklist'],
    contacts: job.contacts as JobLead['contacts'],
    interviews: job.interviews as JobLead['interviews'],
    prepPack: job.prepPack as JobLead['prepPack'],
  };
}

export function mapDbPreferences(profile: any): UserPreferences {
  if (!profile) return defaultPreferences;
  return {
    currentLevel: profile.currentLevel,
    targetLevel: profile.targetLevel,
    targetRoles: profile.targetRoles,
    preferredRegions: profile.preferredRegions,
    preferredTitles: profile.preferredTitles,
    preferredStack: profile.preferredStack,
    mustHaveTech: profile.mustHaveTech,
    workRegions: profile.workRegions,
    remoteOnly: profile.remoteOnly,
    salaryMin: profile.salaryMin,
    salaryTarget: profile.salaryTarget,
    timezoneToleranceHours: profile.timezoneToleranceHours,
  };
}

export async function seedUserWorkspace(userId: string) {
  await prisma.userProfile.create({
    data: {
      userId,
      currentLevel: defaultPreferences.currentLevel,
      targetLevel: defaultPreferences.targetLevel,
      targetRoles: defaultPreferences.targetRoles,
      preferredRegions: defaultPreferences.preferredRegions,
      preferredTitles: defaultPreferences.preferredTitles,
      preferredStack: defaultPreferences.preferredStack,
      mustHaveTech: defaultPreferences.mustHaveTech,
      workRegions: defaultPreferences.workRegions,
      remoteOnly: defaultPreferences.remoteOnly,
      salaryMin: defaultPreferences.salaryMin,
      salaryTarget: defaultPreferences.salaryTarget,
      timezoneToleranceHours: defaultPreferences.timezoneToleranceHours,
      onboardingCompleted: false,
    },
  });

  await prisma.jobLead.createMany({
    data: demoJobs.map((job) => ({
      userId,
      company: job.company,
      title: job.title,
      source: job.source,
      jobUrl: job.jobUrl,
      location: job.location,
      remoteType: job.remoteType,
      timezoneRequirement: job.timezoneRequirement,
      eligibilityRegion: job.eligibilityRegion,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      currency: job.currency,
      notes: job.notes,
      status: job.status,
      dateFound: new Date(job.dateFound),
      dateApplied: job.dateApplied ? new Date(job.dateApplied) : null,
      nextFollowUp: job.nextFollowUp ? new Date(job.nextFollowUp) : null,
      priorityFlag: job.priorityFlag,
      score: job.score,
      checklist: job.checklist,
      contacts: job.contacts,
      interviews: job.interviews,
      prepPack: job.prepPack,
    })),
  });

  await prisma.followUpTemplate.createMany({
    data: demoTemplates.map((template) => ({
      userId,
      type: template.type,
      name: template.name,
      subject: template.subject,
      body: template.body,
      isDefault: true,
    })),
  });
}

export async function getUserWorkspace(userId: string) {
  const [profile, jobs, templates] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.jobLead.findMany({ where: { userId }, orderBy: [{ updatedAt: 'desc' }, { dateFound: 'desc' }] }),
    prisma.followUpTemplate.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ]);

  return {
    preferences: mapDbPreferences(profile),
    onboardingCompleted: Boolean(profile?.onboardingCompleted),
    jobs: jobs.map(mapDbJob),
    templates: templates.map((template) => ({
      id: template.id,
      type: template.type,
      name: template.name,
      subject: template.subject || undefined,
      body: template.body,
    })) as Template[],
  };
}

export async function getUserPreferences(userId: string) {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  return mapDbPreferences(profile);
}

export function buildStoredJobPayload(values: JobFormValues | any, preferences: UserPreferences) {
  const job = {
    id: values.id || '',
    company: values.company,
    title: values.title,
    source: values.source,
    jobUrl: values.jobUrl,
    location: values.location,
    remoteType: values.remoteType,
    timezoneRequirement: values.timezoneRequirement,
    eligibilityRegion: values.eligibilityRegion,
    salaryMin: values.salaryMin ? Number(values.salaryMin) : undefined,
    salaryMax: values.salaryMax ? Number(values.salaryMax) : undefined,
    currency: values.currency || 'USD',
    notes: values.notes,
    status: values.status,
    dateFound: values.dateFound || new Date().toISOString().slice(0, 10),
    dateApplied: values.status === 'APPLIED' ? new Date().toISOString().slice(0, 10) : undefined,
    nextFollowUp: values.nextFollowUp || undefined,
    priorityFlag: 'MONITOR' as JobLead['priorityFlag'],
    score: {
      coreStackMatch: Number(values.coreStackMatch),
      roleAlignment: Number(values.roleAlignment),
      seniorityFit: Number(values.seniorityFit),
      geographyEligibility: Number(values.geographyEligibility),
      timezoneCompatibility: Number(values.timezoneCompatibility),
      compensationFit: Number(values.compensationFit),
      domainRelevance: Number(values.domainRelevance),
      applicationFriction: Number(values.applicationFriction),
      signalQuality: Number(values.signalQuality),
      fitScore: 0,
      fitTier: 'D' as JobLead['score']['fitTier'],
    },
    checklist: {
      resumeTailored: false,
      pdfChecked: false,
      coverLetterReady: false,
      portfolioAdded: false,
      videoDone: false,
      compensationChecked: false,
      eligibilityChecked: false,
      submitted: false,
      ...(values.checklist || {}),
    },
    contacts: values.contacts || [],
    interviews: values.interviews || [],
    prepPack: values.prepPack || {
      whyThisRole: '',
      topFitPoints: '',
      likelyQuestions: '',
      questionsToAsk: '',
      technicalFocus: '',
      companyResearchLinks: '',
      prepScore: 0,
      prepStatus: 'NOT_STARTED',
    },
  } as JobLead;

  const fitScore = calculateFitScore(job, preferences);
  const fitTier = calculateFitTier(fitScore);
  const scored = { ...job, score: { ...job.score, fitScore, fitTier } };
  return { ...scored, priorityFlag: calculatePriority(scored) };
}
