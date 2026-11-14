/**
 * Deterministic preparation planner.
 *
 * No model is called here. The planner decides:
 *   - which existing resume is the strongest starting point,
 *   - whether each optional material is genuinely relevant,
 *   - what the user should see before pressing "Prepare my application".
 *
 * The AI-assisted generation happens later, one durable task at a time. Keeping
 * the plan deterministic means the same job and profile always produce the same
 * checklist, and a rejected task can be explained without re-asking a model.
 */

import { createHash } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { resumeContentSchema, type ResumeContent } from '@/lib/resume-builder/schema';
import { JOB_INTELLIGENCE_MIN_JOB_CHARS } from '@/lib/job-intelligence/limits';
import {
  EXECUTABLE_TASK_TYPES,
  TASK_LABELS,
  type PreparationChecklistItem,
  type PreparationPlan,
  type PreparationTaskType,
  type SourceResumeSelection,
} from './types';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'are', 'will', 'that', 'this', 'from',
  'have', 'has', 'job', 'role', 'work', 'team', 'teams', 'who', 'what', 'all', 'can', 'not',
  'but', 'they', 'their', 'them', 'about', 'into', 'more', 'than', 'also', 'been', 'were',
  'was', 'its', 'it\u2019s', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'as', 'is', 'be', 'or',
  'we', 'us', 'by', 'if', 'do', 'does', 'how', 'why', 'when', 'where', 'which', 'while',
  'using', 'use', 'used', 'strong', 'good', 'great', 'must', 'should', 'would', 'could',
]);

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9+#.]{2,}/g) ?? []).filter(
    (token) => token.length >= 2 && !STOP_WORDS.has(token),
  );
}

function tokenSet(value: string): Set<string> {
  return new Set(tokenize(value));
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function parseResumeContent(value: unknown): ResumeContent | null {
  const parsed = resumeContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function resumeText(content: ResumeContent): string {
  return [
    content.summary ?? '',
    content.basics.headline ?? '',
    ...content.skills.map((skill) => skill.name),
    ...content.experiences.flatMap((entry) => [
      entry.jobTitle ?? '',
      entry.company ?? '',
      ...entry.responsibilities,
      ...entry.achievements,
      ...entry.technologies,
    ]),
    ...content.projects.flatMap((entry) => [
      entry.name ?? '',
      entry.description ?? '',
      entry.role ?? '',
      ...entry.technologies,
      ...entry.results,
    ]),
    ...content.credentials.map((entry) => entry.name),
  ].join('\n');
}

function jobText(row: {
  title: string;
  skills: string[];
  category: string | null;
  industry: string | null;
  jobDescription: string | null;
  requirements: unknown;
}): string {
  const requirements = row.requirements
    ? JSON.stringify(row.requirements).slice(0, 4_000)
    : '';
  return [
    row.title,
    row.skills.join(' '),
    row.category ?? '',
    row.industry ?? '',
    row.jobDescription ?? '',
    requirements,
  ].join('\n');
}

type ResumeRow = {
  id: string;
  name: string;
  content: unknown;
  targetJobId: string | null;
  revision: number;
  updatedAt: Date;
};

/**
 * Choose the strongest source document.
 *
 * Deterministic and explainable: a targeted variant wins, then title overlap,
 * then skill overlap, then general text relevance, then recency. The job
 * description is never used to invent a claim; it only ranks documents the
 * candidate already wrote.
 */
export function selectSourceResume(params: {
  job: {
    id: string;
    title: string;
    skills: string[];
    category: string | null;
    industry: string | null;
    jobDescription: string | null;
  };
  resumes: ResumeRow[];
  hasConfirmedProfile: boolean;
}): SourceResumeSelection {
  const jobTokens = tokenSet(jobText({ ...params.job, requirements: null }));
  const jobTitleTokens = tokenSet(params.job.title);
  const jobSkillTokens = tokenSet(params.job.skills.join(' '));

  const scored = params.resumes
    .map((resume) => {
      const content = parseResumeContent(resume.content);
      if (!content) {
        return { resume, score: -1_000, reason: 'the stored document is not readable' };
      }

      const text = resumeText(content);
      const contentTokens = tokenSet(text);
      const titleOverlap = intersectionSize(jobTitleTokens, contentTokens);
      const skillOverlap = intersectionSize(jobSkillTokens, contentTokens);
      const generalOverlap = Math.min(60, intersectionSize(jobTokens, contentTokens));
      const targeted = resume.targetJobId === params.job.id;

      let score = titleOverlap * 6 + skillOverlap * 3 + generalOverlap;
      if (targeted) score += 100;
      if (content.experiences.length === 0 && content.projects.length === 0) score -= 40;

      const reasons: string[] = [];
      if (targeted) reasons.push('already tailored to this job');
      if (titleOverlap > 0) reasons.push(`${titleOverlap} matching title term${titleOverlap === 1 ? '' : 's'}`);
      if (skillOverlap > 0) reasons.push(`${skillOverlap} matching skill${skillOverlap === 1 ? '' : 's'}`);
      if (reasons.length === 0) reasons.push('closest available document');

      return { resume, score, reason: reasons.join(', ') };
    })
    .sort((a, b) => b.score - a.score || b.resume.updatedAt.getTime() - a.resume.updatedAt.getTime());

  const candidates = scored.map((entry) => ({
    id: entry.resume.id,
    name: entry.resume.name,
    score: entry.score,
    reason: entry.reason,
  }));

  const best = scored[0];
  if (best && best.score > 0) {
    return {
      kind: 'STRUCTURED_RESUME',
      resumeId: best.resume.id,
      name: best.resume.name,
      reason: `Best starting point: ${best.reason}.`,
      score: best.score,
      candidates,
    };
  }

  if (params.hasConfirmedProfile) {
    return {
      kind: 'PROFILE',
      resumeId: null,
      name: null,
      reason:
        'No strong existing resume was found, so a new one will be built from your confirmed career profile.',
      score: 0,
      candidates,
    };
  }

  return {
    kind: 'NONE',
    resumeId: null,
    name: null,
    reason:
      'No resume or confirmed career profile is available. Add one before preparing a tailored application.',
    score: 0,
    candidates,
  };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function preparationFingerprint(params: {
  job: {
    id: string;
    updatedAt: Date;
    jobDescription: string | null;
    title: string;
    company: string;
  };
  profileVersion: number;
  sourceResume: SourceResumeSelection;
  sourceResumeRevision: number | null;
}): string {
  return hash({
    jobId: params.job.id,
    jobUpdatedAt: params.job.updatedAt.toISOString(),
    title: params.job.title,
    company: params.job.company,
    jobDescriptionChars: params.job.jobDescription?.length ?? 0,
    profileVersion: params.profileVersion,
    sourceKind: params.sourceResume.kind,
    sourceResumeId: params.sourceResume.resumeId,
    sourceResumeRevision: params.sourceResumeRevision,
  }).slice(0, 32);
}

export function preparationDedupeKey(params: {
  userId: string;
  jobId: string;
  fingerprint: string;
  tasks: PreparationTaskType[];
}): string {
  return hash({
    userId: params.userId,
    jobId: params.jobId,
    fingerprint: params.fingerprint,
    tasks: [...params.tasks].sort(),
  }).slice(0, 48);
}

export type BuildPlanResult = {
  plan: PreparationPlan;
  sourceResumeRevision: number | null;
};

export async function buildPreparationPlan(params: {
  userId: string;
  jobId: string;
}): Promise<BuildPlanResult | null> {
  const job = await prisma.jobLead.findFirst({
    where: { id: params.jobId, userId: params.userId, deletedAt: null },
    select: {
      id: true,
      company: true,
      title: true,
      status: true,
      jobUrl: true,
      jobDescription: true,
      requirements: true,
      category: true,
      industry: true,
      skills: true,
      seniority: true,
      contacts: true,
      interviews: true,
      score: true,
      updatedAt: true,
    },
  });
  if (!job) return null;

  const [profile, resumes, materials, prepPacks] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId: params.userId },
      select: {
        careerProfileConfirmedAt: true,
        careerProfileVersion: true,
      },
    }),
    prisma.structuredResume.findMany({
      where: { userId: params.userId },
      select: {
        id: true,
        name: true,
        content: true,
        targetJobId: true,
        revision: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 24,
    }),
    prisma.applicationMaterial.findMany({
      where: { userId: params.userId, jobId: job.id, status: { not: 'ARCHIVED' } },
      select: { id: true, type: true, title: true, status: true, createdAt: true, generationStatus: true },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    prisma.interviewPrepPack.findMany({
      where: { userId: params.userId, jobId: job.id },
      select: { id: true, title: true, status: true, questionCount: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
  ]);

  const hasConfirmedProfile = Boolean(profile?.careerProfileConfirmedAt);
  const sourceResume = selectSourceResume({
    job: {
      id: job.id,
      title: job.title,
      skills: job.skills,
      category: job.category,
      industry: job.industry,
      jobDescription: job.jobDescription,
    },
    resumes,
    hasConfirmedProfile,
  });

  const sourceResumeRevision =
    resumes.find((resume) => resume.id === sourceResume.resumeId)?.revision ?? null;

  const descriptionChars = (job.jobDescription ?? '').trim().length;
  const hasJobDescription = descriptionChars >= JOB_INTELLIGENCE_MIN_JOB_CHARS;
  const jobBody = jobText({
    title: job.title,
    skills: job.skills,
    category: job.category,
    industry: job.industry,
    jobDescription: job.jobDescription,
    requirements: job.requirements,
  });
  const lowerJobBody = jobBody.toLowerCase();

  const score = job.score as { fitScore?: number } | null;
  const fitScore = typeof score?.fitScore === 'number' ? score.fitScore : 0;

  const interviews = Array.isArray(job.interviews) ? job.interviews : [];
  const contacts = Array.isArray(job.contacts) ? job.contacts : [];
  const interviewing =
    job.status === 'INTERVIEWING' ||
    job.status === 'OFFER' ||
    interviews.length > 0;

  const latest = <T extends { createdAt?: Date; updatedAt?: Date }>(rows: T[]): T | undefined =>
    [...rows].sort((a, b) => {
      const aTime = (a.createdAt ?? a.updatedAt)?.getTime() ?? 0;
      const bTime = (b.createdAt ?? b.updatedAt)?.getTime() ?? 0;
      return bTime - aTime;
    })[0];

  const existingCoverLetter = latest(
    materials.filter(
      (material) =>
        material.type === 'COVER_LETTER' &&
        material.generationStatus === 'COMPLETED' &&
        material.status !== 'ARCHIVED',
    ),
  );
  const existingRecruiterMessage = latest(
    materials.filter(
      (material) =>
        material.type === 'RECRUITER_OUTREACH' &&
        material.generationStatus === 'COMPLETED' &&
        material.status !== 'ARCHIVED',
    ),
  );
  const existingTailoredResume = resumes.find((resume) => resume.targetJobId === job.id);
  const existingPrepPack = prepPacks.find(
    (pack) => pack.status === 'READY' || pack.status === 'PARTIALLY_READY',
  );

  const coverLetterRequested = /cover(ing)?\s+letter/.test(lowerJobBody);
  const screeningLanguage =
    /(screening questions?|short answers?|please answer|application questions?)/.test(lowerJobBody);

  const items: PreparationChecklistItem[] = [];

  items.push({
    type: 'RESUME_TAILORING',
    label: TASK_LABELS.RESUME_TAILORING,
    recommendation: existingTailoredResume ? 'OPTIONAL' : 'REQUIRED',
    reason: existingTailoredResume
      ? `A tailored resume already exists (“${existingTailoredResume.name}”). Prepare another only if you want a fresh version.`
      : hasJobDescription
        ? `Recommended from ${sourceResume.kind === 'PROFILE' ? 'your confirmed career profile' : sourceResume.name ?? 'your resume library'}: ${sourceResume.reason}`
        : 'Add the job description so the tailored resume can be grounded in the real role.',
    available: sourceResume.kind !== 'NONE' && hasJobDescription,
    selectedByDefault: !existingTailoredResume && sourceResume.kind !== 'NONE' && hasJobDescription,
    existing: existingTailoredResume
      ? {
          id: existingTailoredResume.id,
          title: existingTailoredResume.name,
          href: `/resumes/${existingTailoredResume.id}`,
        }
      : null,
    estimatedMinutes: 2,
  });

  items.push({
    type: 'COVER_LETTER',
    label: TASK_LABELS.COVER_LETTER,
    recommendation: existingCoverLetter
      ? 'OPTIONAL'
      : coverLetterRequested
        ? 'REQUIRED'
        : fitScore >= 70
          ? 'RECOMMENDED'
          : 'OPTIONAL',
    reason: existingCoverLetter
      ? `A cover letter already exists (“${existingCoverLetter.title}”).`
      : coverLetterRequested
        ? 'The posting explicitly asks for a cover letter.'
        : fitScore >= 70
          ? 'The role is a strong fit, so a specific letter is likely to help.'
          : 'Useful when the role matters to you, but not requested by the employer.',
    available: true,
    selectedByDefault: !existingCoverLetter && coverLetterRequested,
    existing: existingCoverLetter
      ? {
          id: existingCoverLetter.id,
          title: existingCoverLetter.title,
          href: `/application-materials/${existingCoverLetter.id}`,
        }
      : null,
    estimatedMinutes: 1,
  });

  items.push({
    type: 'RECRUITER_MESSAGE',
    label: TASK_LABELS.RECRUITER_MESSAGE,
    recommendation: existingRecruiterMessage
      ? 'OPTIONAL'
      : contacts.length > 0
        ? 'RECOMMENDED'
        : 'OPTIONAL',
    reason: existingRecruiterMessage
      ? `A recruiter message already exists (“${existingRecruiterMessage.title}”).`
      : contacts.length > 0
        ? `You have ${contacts.length} saved contact${contacts.length === 1 ? '' : 's'} for this application.`
        : 'Useful when you have a named recruiter or hiring manager to contact.',
    available: true,
    selectedByDefault: false,
    existing: existingRecruiterMessage
      ? {
          id: existingRecruiterMessage.id,
          title: existingRecruiterMessage.title,
          href: `/application-materials/${existingRecruiterMessage.id}`,
        }
      : null,
    estimatedMinutes: 1,
  });

  items.push({
    type: 'SCREENING_ANSWERS',
    label: TASK_LABELS.SCREENING_ANSWERS,
    recommendation: 'OPTIONAL',
    reason: screeningLanguage
      ? 'The posting mentions application questions. Drafts are prepared in the application workspace with a confirmation step.'
      : 'Only needed when the employer asks custom application questions.',
    available: false,
    selectedByDefault: false,
    existing: null,
    estimatedMinutes: 3,
  });

  items.push({
    type: 'COMPANY_RESEARCH',
    label: TASK_LABELS.COMPANY_RESEARCH,
    recommendation: 'OPTIONAL',
    reason:
      'Source-backed company research is available in Interview Preparation, using official pages.',
    available: false,
    selectedByDefault: false,
    existing: existingPrepPack
      ? {
          id: existingPrepPack.id,
          title: existingPrepPack.title,
          href: `/interview-prep/${existingPrepPack.id}`,
        }
      : null,
    estimatedMinutes: 5,
  });

  items.push({
    type: 'INTERVIEW_BRIEFING',
    label: TASK_LABELS.INTERVIEW_BRIEFING,
    recommendation: existingPrepPack ? 'OPTIONAL' : interviewing ? 'RECOMMENDED' : 'OPTIONAL',
    reason: existingPrepPack
      ? `A preparation pack already exists (“${existingPrepPack.title}”) with ${existingPrepPack.questionCount} question${existingPrepPack.questionCount === 1 ? '' : 's'}.`
      : interviewing
        ? 'You are in the interview stage, so a grounded briefing and practice plan is the next priority.'
        : 'Most useful once you are invited to interview.',
    available: true,
    selectedByDefault: !existingPrepPack && interviewing,
    existing: existingPrepPack
      ? {
          id: existingPrepPack.id,
          title: existingPrepPack.title,
          href: `/interview-prep/${existingPrepPack.id}`,
        }
      : null,
    estimatedMinutes: 4,
  });

  const itemsMeeting = items.filter((item) => item.available);
  const defaults = itemsMeeting.filter((item) => item.selectedByDefault).map((item) => item.type);

  const blockers: string[] = [];
  if (!hasJobDescription) {
    blockers.push('Add or import the job description so preparation is grounded in the real role.');
  }
  if (sourceResume.kind === 'NONE') {
    blockers.push('Add a resume or confirm your career profile first.');
  }

  // The planner knows the executable set. Anything else must never be presented
  // as if pressing the primary action would produce it.
  const availableTypes = new Set(itemsMeeting.map((item) => item.type));
  const canPrepare =
    blockers.length === 0 &&
    defaults.some((type) =>
      (EXECUTABLE_TASK_TYPES as readonly string[]).includes(type) &&
      availableTypes.has(type),
    );

  const plan: PreparationPlan = {
    job: {
      id: job.id,
      company: job.company,
      title: job.title,
      status: job.status,
      fitScore,
      hasJobDescription,
      jobDescriptionChars: descriptionChars,
    },
    sourceResume,
    items,
    primaryAction: 'Prepare my application',
    canPrepare,
    blockers,
    fingerprint: preparationFingerprint({
      job: {
        id: job.id,
        updatedAt: job.updatedAt,
        jobDescription: job.jobDescription,
        title: job.title,
        company: job.company,
      },
      profileVersion: profile?.careerProfileVersion ?? 0,
      sourceResume,
      sourceResumeRevision,
    }),
    limits: {
      maxTasksPerRun: 4,
    },
  };

  return { plan, sourceResumeRevision };
}

/** The default task set for a plan, filtered to what can actually execute. */
export function defaultTasksForPlan(plan: PreparationPlan): PreparationTaskType[] {
  return plan.items
    .filter(
      (item) =>
        item.available &&
        item.selectedByDefault &&
        (EXECUTABLE_TASK_TYPES as readonly string[]).includes(item.type),
    )
    .map((item) => item.type);
}
