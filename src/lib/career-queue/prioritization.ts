import { prisma } from '@/lib/prisma';
import { CareerActionInput, CareerActionType } from './types';

function fitScore(job: { score: unknown }): number {
  const s = job.score as { fitScore?: number } | null;
  return typeof s?.fitScore === 'number' ? s.fitScore : 0;
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  const d = todayStart();
  d.setDate(d.getDate() - n);
  return d;
}

function weekFingerprint(): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const week = Math.ceil((((d.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1) / 7);
  return `${year}-W${week}`;
}

export async function buildCareerActionCandidates(userId: string): Promise<CareerActionInput[]> {
  const candidates: CareerActionInput[] = [];

  const [jobs, profile, resumes, prepPacks, materials] = await Promise.all([
    prisma.jobLead.findMany({
      where: { userId, deletedAt: null, status: { notIn: ['ARCHIVED', 'OFFER', 'REJECTED'] } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.structuredResume.findMany({ where: { userId }, select: { id: true, targetJobId: true } }),
    prisma.interviewPrepPack.findMany({
      where: { userId, status: { in: ['READY', 'PARTIALLY_READY'] } },
      select: { id: true, jobId: true, practicedCount: true, questionCount: true },
    }),
    prisma.applicationMaterial.findMany({ where: { userId, status: { in: ['DRAFT', 'READY'] } }, select: { id: true, jobId: true, type: true, status: true } }),
  ]);

  const targetedResumeJobIds = new Set(resumes.map((r) => r.targetJobId).filter(Boolean) as string[]);

  // Profile completion
  if (!profile?.profileCompleted) {
    candidates.push({
      userId,
      actionType: 'COMPLETE_PROFILE',
      title: 'Complete your career profile',
      description: 'A complete profile improves job matching and AI recommendations.',
      priority: 55,
      sourceType: 'CAREER_PROFILE',
      sourceId: `profile-incomplete:${userId}`,
      origin: 'SYSTEM',
      estimatedMinutes: 15,
    });
  }

  const staleThreshold = daysAgo(7);
  const today = todayStart();

  for (const job of jobs) {
    const score = fitScore(job);

    // Follow-up due
    if (job.nextFollowUp) {
      const due = new Date(job.nextFollowUp);
      if (due <= today) {
        const overdue = due < today;
        candidates.push({
          userId,
          actionType: 'FOLLOW_UP_DUE',
          title: `Follow up with ${job.company}`,
          description: overdue
            ? `Your follow-up for "${job.title}" was due on ${job.nextFollowUp.toISOString().slice(0, 10)}. Reach out now.`
            : `It is time to follow up on your "${job.title}" application at ${job.company}.`,
          priority: 100,
          dueDate: due,
          sourceType: 'JOB_FOLLOW_UP',
          sourceId: `followup:${job.id}:${job.nextFollowUp.toISOString()}`,
          relatedJobId: job.id,
          origin: 'SYSTEM',
          estimatedMinutes: 10,
        });
      }
    }

    // Interview prep
    const pack = prepPacks.find((p) => p.jobId === job.id);
    if (job.status === 'INTERVIEWING' || (job.interviews as unknown[]).length > 0) {
      const remaining = pack ? Math.max(0, pack.questionCount - pack.practicedCount) : 0;
      candidates.push({
        userId,
        actionType: 'PREPARE_INTERVIEW',
        title: `Prepare for ${job.company} interview`,
        description: pack
          ? `You have an active interview track with ${job.company} for "${job.title}". ${remaining} practice questions remain.`
          : `You are in the interview stage for "${job.title}". Review your preparation before it arrives.`,
        priority: 90,
        sourceType: 'INTERVIEW_PREPARATION',
        sourceId: `prep:${job.id}:${pack?.id ?? 'none'}`,
        relatedJobId: job.id,
        relatedPrepPackId: pack?.id ?? null,
        origin: 'SYSTEM',
        estimatedMinutes: 30,
      });
    }

    // Practice interview questions if pack has unpracticed
    if (pack && pack.questionCount > pack.practicedCount) {
      candidates.push({
        userId,
        actionType: 'PRACTICE_INTERVIEW_QUESTION',
        title: `Practice interview questions for ${job.company}`,
        description: `${pack.questionCount - pack.practicedCount} remaining practice questions for "${job.title}".`,
        priority: 85,
        sourceType: 'INTERVIEW_PREPARATION',
        sourceId: `practice:${pack.id}:${pack.practicedCount}`,
        relatedJobId: job.id,
        relatedPrepPackId: pack.id,
        origin: 'SYSTEM',
        estimatedMinutes: 20,
      });
    }

    // Apply
    if ((job.status === 'SAVED' || job.status === 'LEAD') && score >= 70) {
      candidates.push({
        userId,
        actionType: 'APPLY_TO_JOB',
        title: `Apply to ${job.company}`,
        description: `"${job.title}" at ${job.company} is a strong match (score ${score}). Move it to Applied today.`,
        priority: 80,
        sourceType: 'JOB_MATCH',
        sourceId: `apply:${job.id}`,
        relatedJobId: job.id,
        origin: 'SYSTEM',
        estimatedMinutes: 25,
      });
    }

    // Tailor resume for promising job if no targeted resume
    if (score >= 60 && !targetedResumeJobIds.has(job.id) && (job.status === 'SAVED' || job.status === 'LEAD' || job.status === 'APPLYING')) {
      candidates.push({
        userId,
        actionType: 'TAILOR_RESUME',
        title: `Tailor a resume for ${job.company}`,
        description: `No tailored resume is linked to "${job.title}". Create one from your profile before applying.`,
        priority: 75,
        sourceType: 'RESUME',
        sourceId: `tailor:${job.id}`,
        relatedJobId: job.id,
        origin: 'SYSTEM',
        estimatedMinutes: 30,
      });
    }

    // Review application materials drafts
    const jobMaterials = materials.filter((m) => m.jobId === job.id);
    const draftMaterials = jobMaterials.filter((m) => m.status === 'DRAFT');
    if (draftMaterials.length > 0) {
      candidates.push({
        userId,
        actionType: 'REVIEW_APPLICATION_MATERIAL',
        title: `Review application draft for ${job.company}`,
        description: `You have ${draftMaterials.length} draft material(s) for "${job.title}". Review and finalize before submitting.`,
        priority: 70,
        sourceType: 'APPLICATION_MATERIAL',
        sourceId: `material-review:${job.id}:${draftMaterials.map((m) => m.id).join(',')}`,
        relatedJobId: job.id,
        origin: 'SYSTEM',
        estimatedMinutes: 15,
      });
    }

    // Stale
    const updatedAt = job.updatedAt instanceof Date ? job.updatedAt : new Date(job.updatedAt);
    if (updatedAt <= staleThreshold) {
      candidates.push({
        userId,
        actionType: 'REVIEW_JOB_DETAILS',
        title: `Review stale lead — ${job.company}`,
        description: `Your "${job.title}" lead at ${job.company} has not moved in over 7 days. Archive it or take action.`,
        priority: 60,
        sourceType: 'JOB_MATCH',
        sourceId: `stale:${job.id}:${updatedAt.toISOString()}`,
        relatedJobId: job.id,
        origin: 'SYSTEM',
        estimatedMinutes: 5,
      });
    }

    // Low score review
    if (score < 50) {
      candidates.push({
        userId,
        actionType: 'REVIEW_OPPORTUNITY',
        title: `Review low-score job — ${job.company}`,
        description: `"${job.title}" at ${job.company} has a low fit score (${score}). Consider whether it is worth pursuing.`,
        priority: 40,
        sourceType: 'JOB_MATCH',
        sourceId: `review-low:${job.id}`,
        relatedJobId: job.id,
        origin: 'SYSTEM',
        estimatedMinutes: 5,
      });
    }

    // Review missing job details (no description)
    if (!job.jobDescription) {
      candidates.push({
        userId,
        actionType: 'REVIEW_JOB_DETAILS',
        title: `Verify details for ${job.company}`,
        description: `No job description is stored for "${job.title}". Verify requirements before applying.`,
        priority: 45,
        sourceType: 'JOB_MATCH',
        sourceId: `missing-desc:${job.id}`,
        relatedJobId: job.id,
        origin: 'SYSTEM',
        estimatedMinutes: 10,
      });
    }
  }

  // Weekly review action
  candidates.push({
    userId,
    actionType: 'REVIEW_WEEKLY_PROGRESS',
    title: 'Review your weekly job-search progress',
    description: 'Take a few minutes to review what you accomplished this week and plan next steps.',
    priority: 30,
    sourceType: 'CAREER_REVIEW',
    sourceId: `weekly-review:${userId}:${weekFingerprint()}`,
    origin: 'SYSTEM',
    estimatedMinutes: 10,
  });

  return candidates;
}
