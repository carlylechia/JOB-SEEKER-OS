import { prisma } from './prisma';
import { demoTemplates } from './demo-data';
import { defaultPreferences, defaultTitleOptions } from './preferences';
import { JobLead, JobFormValues, Template, UserPreferences, UserProfileDetails } from '@/types';
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
    timezoneMatches: profile.timezoneMatches ?? [],
    remoteOnly: profile.remoteOnly,
    salaryMin: profile.salaryMin,
    salaryTarget: profile.salaryTarget,
    timezoneToleranceHours: profile.timezoneToleranceHours,
  };
}

export function mapDbProfile(user: any, profile: any): UserProfileDetails {
  return {
    fullName: user?.name || '',
    headline: profile?.headline || '',
    portfolioUrl: profile?.portfolioUrl || '',
    githubUrl: profile?.githubUrl || '',
    linkedinUrl: profile?.linkedinUrl || '',
    resumeUrl: profile?.resumeUrl || '',
    profileCompleted: Boolean(profile?.profileCompleted),
  };
}

export async function ensureDefaultJobTitles() {
  for (const name of defaultTitleOptions) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await prisma.jobTitle.upsert({
      where: { slug },
      update: {},
      create: { name, slug },
    });
  }
}

export async function seedUserWorkspace(userId: string) {
  await ensureDefaultJobTitles();

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
      timezoneMatches: defaultPreferences.timezoneMatches,
      remoteOnly: defaultPreferences.remoteOnly,
      salaryMin: defaultPreferences.salaryMin,
      salaryTarget: defaultPreferences.salaryTarget,
      timezoneToleranceHours: defaultPreferences.timezoneToleranceHours,
      onboardingCompleted: false,
      profileCompleted: false,
    },
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
  await ensureDefaultJobTitles();
  const [user, profile, jobs, templates, titleOptions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.jobLead.findMany({ where: { userId }, orderBy: [{ updatedAt: 'desc' }, { dateFound: 'desc' }] }),
    prisma.followUpTemplate.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.jobTitle.findMany({ orderBy: { name: 'asc' } }),
  ]);

  return {
    preferences: mapDbPreferences(profile),
    onboardingCompleted: Boolean(profile?.onboardingCompleted),
    profile: mapDbProfile(user, profile),
    jobs: jobs.map(mapDbJob),
    templates: templates.map((template) => ({
      id: template.id,
      type: template.type,
      name: template.name,
      subject: template.subject || undefined,
      body: template.body,
    })) as Template[],
    titleOptions: titleOptions.map((item) => item.name),
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
      titleMatch: false,
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
