/**
 * Task executors for the preparation workflow.
 *
 * Each executor reuses the existing, independently-tested feature service:
 *
 *   RESUME_TAILORING   → resume-builder optimisation + independent variant
 *   COVER_LETTER       → application-materials generation
 *   RECRUITER_MESSAGE  → application-materials generation
 *   INTERVIEW_BRIEFING → interview-preparation pack generation
 *
 * No executor invents a second document engine, a second prompt or a second
 * credit ledger. Credits, entitlement checks, model choice and verification all
 * stay inside the service that already owns them.
 */

import { prisma } from '@/lib/prisma';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { RunGenerationResult, runGeneration } from '@/lib/application-materials/service';
import {
  applyToContent,
  runOptimization,
} from '@/lib/resume-builder/optimization/service';
import type { ResumeContent } from '@/lib/resume-builder/schema';
import {
  createResume,
  duplicateResume,
  updateResume,
} from '@/lib/resume-builder/documents';
import { createAndGeneratePrepPack } from '@/lib/interview-prep/service';
import { assessGeneratedText } from '@/lib/ai/quality';
import type { PreparationTaskType, SourceResumeSelection } from './types';

export type TaskExecutionOutcome =
  | {
      status: 'COMPLETED';
      resultRef: string;
      resultKind: 'RESUME' | 'MATERIAL' | 'PREP_PACK';
      metadata?: Record<string, unknown>;
    }
  | {
      status: 'SKIPPED';
      errorCode: string;
      metadata?: Record<string, unknown>;
    }
  | {
      status: 'FAILED';
      errorCode: string;
      retryable: boolean;
      metadata?: Record<string, unknown>;
    };

export type RunSelection = {
  sourceKind: SourceResumeSelection['kind'];
  sourceResumeId: string | null;
  sourceResumeRevision: number | null;
  sourceReason: string;
};

export const TASK_ERROR_MESSAGES: Record<string, string> = {
  NO_SOURCE_RESUME: 'Add a resume or confirm your career profile first.',
  NO_JOB_DESCRIPTION: 'Add the job description so this task is grounded in the real role.',
  NO_SAFE_IMPROVEMENTS: 'No unsupported rewrite was safe enough to apply. Your resume is unchanged.',
  RESUME_LIMIT_REACHED: 'Your plan’s resume limit has been reached. Archive one or upgrade to continue.',
  PLAN_REQUIRED: 'This task needs a plan that includes the relevant AI feature.',
  USAGE_LIMIT_EXCEEDED: 'You have reached this month’s AI limit for that feature.',
  OPTIMIZATION_FAILED: 'The resume could not be tailored. Your master resume is unchanged.',
  MATERIAL_FAILED: 'The draft could not be generated.',
  PREP_FAILED: 'The interview briefing could not be generated.',
  AI_NOT_CONFIGURED: 'AI generation is not configured on this deployment.',
  AI_RATE_LIMITED: 'The AI provider is busy. This task will retry shortly.',
  AI_TIMEOUT: 'The AI provider timed out. This task will retry.',
  UNKNOWN_ERROR: 'This task could not be completed.',
  INTERRUPTED: 'The previous attempt was interrupted before it finished.',
};

export function taskErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return TASK_ERROR_MESSAGES[code] ?? 'This task could not be completed.';
}

const RETRYABLE_CODES = new Set([
  'AI_RATE_LIMITED',
  'AI_TIMEOUT',
  'AI_UNAVAILABLE',
  'AI_EMPTY_RESPONSE',
  'PROVIDER_ERROR',
]);

function classifyThrown(error: unknown): TaskExecutionOutcome {
  const code =
    typeof (error as { code?: unknown })?.code === 'string'
      ? ((error as { code: string }).code as string)
      : typeof (error as { name?: unknown })?.name === 'string' &&
          (error as { name: string }).name === 'PlanRequiredError'
        ? 'PLAN_REQUIRED'
        : typeof (error as { name?: unknown })?.name === 'string' &&
            (error as { name: string }).name === 'UsageLimitExceededError'
          ? 'USAGE_LIMIT_EXCEEDED'
          : typeof (error as { name?: unknown })?.name === 'string' &&
              (error as { name: string }).name === 'ResumeLimitExceededError'
            ? 'RESUME_LIMIT_REACHED'
            : 'UNKNOWN_ERROR';

  return {
    status: 'FAILED',
    errorCode: code,
    retryable: RETRYABLE_CODES.has(code),
  };
}

function deterministicResumeName(params: { company: string; title: string; date?: Date }): string {
  const date = (params.date ?? new Date()).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return `Resume — ${params.company} — ${params.title} — ${date}`.slice(0, 120);
}

async function ensureTailoringSource(params: {
  userId: string;
  jobId: string;
  job: { company: string; title: string };
  selection: RunSelection;
}): Promise<string | null> {
  if (params.selection.sourceKind === 'STRUCTURED_RESUME' && params.selection.sourceResumeId) {
    const existing = await prisma.structuredResume.findFirst({
      where: { id: params.selection.sourceResumeId, userId: params.userId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  if (params.selection.sourceKind !== 'PROFILE') return null;

  const entitlements = await getEntitlements(params.userId);
  const created = await createResume({
    userId: params.userId,
    limit: entitlements.limits.resumes,
    input: {
      from: 'PROFILE',
      name: deterministicResumeName({
        company: params.job.company,
        title: params.job.title,
      }),
      targetJobId: params.jobId,
    },
  });
  return created.id;
}

async function executeResumeTailoring(params: {
  userId: string;
  jobId: string;
  route: string;
  selection: RunSelection;
}): Promise<TaskExecutionOutcome> {
  const job = await prisma.jobLead.findFirst({
    where: { id: params.jobId, userId: params.userId, deletedAt: null },
    select: { id: true, company: true, title: true, jobDescription: true },
  });
  if (!job) {
    return { status: 'FAILED', errorCode: 'NO_JOB_DESCRIPTION', retryable: false };
  }
  if ((job.jobDescription ?? '').trim().length === 0) {
    return { status: 'FAILED', errorCode: 'NO_JOB_DESCRIPTION', retryable: false };
  }

  const sourceResumeId = await ensureTailoringSource({
    userId: params.userId,
    jobId: params.jobId,
    job,
    selection: params.selection,
  });
  if (!sourceResumeId) {
    return { status: 'FAILED', errorCode: 'NO_SOURCE_RESUME', retryable: false };
  }

  const optimization = await runOptimization({
    userId: params.userId,
    resumeId: sourceResumeId,
    jobId: params.jobId,
    route: params.route,
  });

  if (optimization.outcome === 'FAILED') {
    return {
      status: 'FAILED',
      errorCode: optimization.code,
      retryable: optimization.retryable,
    };
  }

  const operations = optimization.data.operations;
  if (operations.length === 0) {
    return {
      status: 'SKIPPED',
      errorCode: 'NO_SAFE_IMPROVEMENTS',
      metadata: {
        optimizationId: optimization.optimization.id,
        informationGaps: optimization.data.informationGaps.length,
      },
    };
  }

  const source = await prisma.structuredResume.findFirst({
    where: { id: sourceResumeId, userId: params.userId },
    select: {
      id: true,
      revision: true,
      content: true,
      templateKey: true,
      accentKey: true,
      density: true,
      pageSize: true,
      hiddenSections: true,
      sectionOrder: true,
    },
  });
  if (!source) {
    return { status: 'FAILED', errorCode: 'NO_SOURCE_RESUME', retryable: false };
  }

  const entitlements = await getEntitlements(params.userId);
  const tailoredName = deterministicResumeName({ company: job.company, title: job.title });

  const duplicate = await duplicateResume({
    userId: params.userId,
    resumeId: sourceResumeId,
    name: tailoredName,
    targetJobId: params.jobId,
    limit: entitlements.limits.resumes,
  });

  const nextContent = applyToContent(source.content as unknown as ResumeContent, operations);

  // The duplicate starts at revision 1. One conditional write applies the
  // verified operations and restores the source document's presentation, so a
  // tailored variant looks like the master it came from instead of silently
  // resetting to the default template.
  const tailored = await updateResume({
    userId: params.userId,
    resumeId: duplicate.id,
    input: {
      content: nextContent,
      name: tailoredName,
      targetJobId: params.jobId,
      templateKey: source.templateKey as never,
      accentKey: source.accentKey as never,
      density: source.density,
      pageSize: source.pageSize as never,
      // Stored values were validated when the source resume was written; the
      // casts keep the compiler happy without weakening the runtime schema
      // check inside `updateResume`.
      hiddenSections: source.hiddenSections as never,
      sectionOrder: source.sectionOrder as never,
      expectedRevision: duplicate.revision,
    },
  });

  return {
    status: 'COMPLETED',
    resultRef: tailored.id,
    resultKind: 'RESUME',
    metadata: {
      sourceResumeId,
      optimizationId: optimization.optimization.id,
      optimizedOperations: operations.length,
      rejectedOperations: optimization.data.rejected.length,
      creditsConsumed:
        optimization.outcome === 'COMPLETED' ? optimization.creditsConsumed : 0,
    },
  };
}

async function executeMaterial(params: {
  userId: string;
  jobId: string;
  route: string;
  type: 'COVER_LETTER' | 'RECRUITER_OUTREACH';
  selection: RunSelection;
}): Promise<TaskExecutionOutcome> {
  // Prefer the resume tailored in this task set, then the selected source. A
  // refused cross-user id is impossible: both lookups are ownership-scoped.
  const tailored = await prisma.structuredResume.findFirst({
    where: { userId: params.userId, targetJobId: params.jobId },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });

  const resumeId = tailored?.id ?? params.selection.sourceResumeId ?? null;

  const result: RunGenerationResult = await runGeneration({
    userId: params.userId,
    type: params.type,
    jobId: params.jobId,
    resumeId,
    origin: 'AI_GENERATED',
    supersedesId: null,
    route: params.route,
    tone: 'PROFESSIONAL',
    length: 'STANDARD',
    instructions: null,
    conversation: null,
    recipientName: null,
    sourceDraft: null,
  });

  if (result.outcome === 'FAILED') {
    return {
      status: 'FAILED',
      errorCode: result.code,
      retryable: result.retryable,
    };
  }

  const quality = assessGeneratedText(result.material.content, { minChars: 120 });

  return {
    status: 'COMPLETED',
    resultRef: result.summary.id,
    resultKind: 'MATERIAL',
    metadata: {
      generationOutcome: result.outcome,
      model: result.summary.model,
      creditsConsumed: result.outcome === 'COMPLETED' ? result.creditsConsumed : 0,
      // A deterministic report, not an AI judgement. Warnings are stored for
      // the application workspace to surface; they never silently block a
      // draft the feature service already verified.
      quality: {
        ok: quality.ok,
        issues: quality.issues.map((issue) => issue.code),
      },
    },
  };
}

async function executeInterviewBriefing(params: {
  userId: string;
  jobId: string;
  route: string;
}): Promise<TaskExecutionOutcome> {
  const result = await createAndGeneratePrepPack({
    userId: params.userId,
    jobId: params.jobId,
    route: params.route,
  });

  if (result.outcome === 'FAILED') {
    return {
      status: 'FAILED',
      errorCode: result.code,
      retryable: result.retryable,
    };
  }

  return {
    status: 'COMPLETED',
    resultRef: result.pack.id,
    resultKind: 'PREP_PACK',
    metadata: {
      generationOutcome: result.outcome,
      questionCount: result.pack.questionCount,
      researchStatus: result.pack.researchStatus,
      creditsConsumed: result.outcome === 'COMPLETED' ? result.creditsConsumed : 0,
    },
  };
}

export async function executePreparationTask(params: {
  userId: string;
  jobId: string;
  type: PreparationTaskType;
  route: string;
  selection: RunSelection;
}): Promise<TaskExecutionOutcome> {
  try {
    switch (params.type) {
      case 'RESUME_TAILORING':
        return await executeResumeTailoring(params);
      case 'COVER_LETTER':
        return await executeMaterial({ ...params, type: 'COVER_LETTER' });
      case 'RECRUITER_MESSAGE':
        return await executeMaterial({ ...params, type: 'RECRUITER_OUTREACH' });
      case 'INTERVIEW_BRIEFING':
        return await executeInterviewBriefing(params);
      default:
        return {
          status: 'FAILED',
          errorCode: 'TASK_NOT_IMPLEMENTED',
          retryable: false,
        };
    }
  } catch (error) {
    return classifyThrown(error);
  }
}
