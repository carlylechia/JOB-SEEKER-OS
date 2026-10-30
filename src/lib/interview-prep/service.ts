/**
 * Interview preparation orchestration.
 *
 * This is the only module allowed to start a paid AI operation for interview
 * preparation. It runs the same checks in the same order for every request,
 * and every one of them happens BEFORE we spend money:
 *
 *   1. authenticate            (the caller passes a session-derived userId)
 *   2. check the entitlement   (subscriptions.ts, timestamp-derived)
 *   3. resolve the pack        (ownership-scoped)
 *   4. load candidate evidence (profile + targeted resume fallback)
 *   5. build bounded research  (only user-supplied URLs, safely fetched)
 *   6. compute the fingerprint (stored so staleness is a comparison)
 *   7. reserve usage           (shared aiCredits allowance)
 *   8. run generation          (no database lock held while waiting)
 *   9. verify everything       (sources, quotes, counts, anti-fabrication)
 *  10. persist the outcome     (content, questions, tasks, sources, progress)
 *
 * No external call ever happens inside a database transaction.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hasPrismaUniqueViolation } from '@/lib/db-helpers';
import { requireEntitlement, type Entitlement } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError, consumeUsage } from '@/lib/billing/usage';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import {
  InterviewPrepAiError,
  resolveInterviewPrepAiProvider,
  type InterviewPrepAiProvider,
} from './ai-client';
import { buildCandidateContext, type CandidateContext } from './context';
import { buildResearchBundle, importJobPosting, type ResearchSource } from './research';
import {
  INTERVIEW_PREP_ERROR_MESSAGES,
  INTERVIEW_PREP_PROMPT_VERSION,
  INTERVIEW_PREP_SCHEMA_VERSION,
  interviewTrackForContext,
  type AnswerStructure,
  type Difficulty,
  type EvidenceStatus,
  type InterviewContext,
  type InterviewPrepErrorCode,
  type InterviewPrepPackData,
  type PackStatus,
  type PracticeMode,
  type PracticeSessionSummary,
  type PrepContent,
  type PrepHorizon,
  type PrepTask,
  type PrepTiming,
  type Priority,
  type QuestionCategory,
  type ReadinessSummary,
  type ResearchSourceKind,
  type ResearchSourceView,
  type ResearchStatus,
  type RubricDimension,
  type SourceType,
  type StoredFeedback,
  type TaskCategory,
  type TaskStatus,
} from './schema';
import {
  INTERVIEW_PREP_MAX_ANSWER_CHARS,
  INTERVIEW_PREP_MAX_QUESTIONS,
  INTERVIEW_PREP_MAX_RESEARCH_URLS,
  INTERVIEW_PREP_MAX_SOURCE_TEXT_CHARS,
  INTERVIEW_PREP_MAX_TASKS,
  INTERVIEW_PREP_MIN_ANSWER_CHARS,
  INTERVIEW_PREP_MIN_MANUAL_CHARS,
  INTERVIEW_PREP_MIN_TASKS,
  INTERVIEW_PREP_MIN_USEFUL_QUESTIONS,
  INTERVIEW_PREP_PROCESSING_STALE_MS,
} from './limits';
import {
  calculateReadiness,
  defaultPracticeModeForContext,
  fallbackTasks,
  horizonRank,
  resolveHorizon,
  selectPracticeQuestionIds,
  sortTasks,
  summariseSession,
} from './plan';
import { classifyRole } from './role-family';
import {
  ALLOWED_DIMENSIONS,
  verifyFeedback,
  verifyPack,
  type ProfileEvidence,
  type VerificationSource,
} from './verify';

/**
 * Feature key and metered capability.
 *
 * `AI_INTERVIEW_PREP` already existed in the monetization registry. Pack
 * generation and practice feedback both draw on the shared `aiCredits`
 * allowance: one AI allowance, not several competing ones.
 */
export const INTERVIEW_PREP_FEATURE = 'AI_INTERVIEW_PREP' as const;

// ─── Errors ────────────────────────────────────────────────────────────────

export class InterviewPrepPackNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Preparation pack not found.');
    this.name = 'InterviewPrepPackNotFoundError';
  }
}

export class InterviewPrepJobNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Job not found.');
    this.name = 'InterviewPrepJobNotFoundError';
  }
}

export class DuplicatePrepGenerationInFlightError extends Error {
  readonly code = 'DUPLICATE_REQUEST';
  readonly status = 409;

  constructor() {
    super('This preparation pack is already being generated.');
    this.name = 'DuplicatePrepGenerationInFlightError';
  }
}

export class PracticeAnswerTooShortError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;

  constructor() {
    super('Write a bit more before requesting feedback — a few sentences gives something useful to evaluate.');
    this.name = 'PracticeAnswerTooShortError';
  }
}

export class PrepValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;
  readonly errorCode: InterviewPrepErrorCode | 'INVALID_PREP_REQUEST';

  constructor(message: string, errorCode: InterviewPrepErrorCode | 'INVALID_PREP_REQUEST' = 'INVALID_PREP_REQUEST') {
    super(message);
    this.name = 'PrepValidationError';
    this.errorCode = errorCode;
  }
}

export class PrepSessionNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Practice session not found.');
    this.name = 'PrepSessionNotFoundError';
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type PrepPackSummary = {
  id: string;
  jobId: string | null;
  title: string;
  company: string;
  roleTitle: string;
  location: string | null;
  jobUrl: string | null;
  context: string;
  interviewAt: Date | null;
  interviewFormat: string;
  timing: string;
  status: string;
  researchStatus: string;
  questionCount: number;
  practicedCount: number;
  feedbackCount: number;
  lastPracticedAt: Date | null;
  lastActivityAt: Date;
  generatedAt: Date | null;
  isFresh: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PrepPackDetail = {
  pack: PrepPackSummary;
  data: InterviewPrepPackData;
  sources: ResearchSourceView[];
  tasks: PrepTask[];
  sessions: PracticeSessionView[];
  readiness: ReadinessSummary;
  practicedQuestionIds: string[];
  feedbackQuestionIds: string[];
};

export type PrepProgress = {
  packId: string;
  questionCount: number;
  answeredCount: number;
  practicedCount: number;
  feedbackCount: number;
  outstandingCount: number;
  taskCount: number;
  tasksCompleted: number;
  mockSessionsCompleted: number;
  lastPracticedAt: Date | null;
  readiness: ReadinessSummary;
};

export type PracticeAttemptView = {
  id: string;
  packId: string;
  questionId: string;
  sessionId: string | null;
  kind: string;
  parentAttemptId: string | null;
  followUpQuestion: string | null;
  questionVersion: number;
  attemptNumber: number;
  answer: string;
  feedback: StoredFeedback | null;
  rubricKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PracticeSessionView = {
  id: string;
  packId: string;
  mode: string;
  status: string;
  questionIds: string[];
  summary: PracticeSessionSummary | null;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
};

export type CreatePrepPackInput = {
  userId: string;
  jobId?: string | null;
  title?: string | null;
  company?: string | null;
  roleTitle?: string | null;
  location?: string | null;
  jobUrl?: string | null;
  jobDescription?: string | null;
  companyWebsiteUrl?: string | null;
  careersUrl?: string | null;
  interviewAt?: Date | null;
  timing?: PrepTiming;
  context?: InterviewContext;
  interviewFormat?: InterviewContext;
  interviewLanguage?: string | null;
  interviewerInfo?: string | null;
  invitationNotes?: string | null;
  concerns?: string | null;
  focusTopics?: string[];
  researchUrls?: string[];
  force?: boolean;
};

export type CreatePrepPackResult = {
  pack: PrepPackSummary;
  reused: boolean;
};

export type RunPrepGenerationResult =
  | { outcome: 'REUSED'; pack: PrepPackSummary; data: InterviewPrepPackData }
  | { outcome: 'COMPLETED'; pack: PrepPackSummary; data: InterviewPrepPackData; creditsConsumed: number }
  | {
      outcome: 'FAILED';
      pack: PrepPackSummary | null;
      code: InterviewPrepErrorCode;
      message: string;
      retryable: boolean;
    };

type PackRow = {
  id: string;
  userId: string;
  jobId: string | null;
  title: string;
  company: string;
  roleTitle: string;
  location: string | null;
  jobUrl: string | null;
  jobDescription: string | null;
  researchUrls: string[];
  companyWebsiteUrl: string | null;
  careersUrl: string | null;
  interviewerInfo: string | null;
  interviewLanguage: string | null;
  invitationNotes: string | null;
  concerns: string | null;
  focusTopics: string[];
  interviewAt: Date | null;
  interviewFormat: string;
  timing: string;
  context: string;
  status: string;
  researchStatus: string;
  researchSummary: string | null;
  researchErrorCode: string | null;
  schemaVersion: number;
  promptVersion: number;
  inputFingerprint: string;
  dedupeKey: string;
  content: unknown;
  preparationGuidance: string | null;
  limitations: string[];
  questionCount: number;
  practicedCount: number;
  feedbackCount: number;
  lastPracticedAt: Date | null;
  lastActivityAt: Date;
  generatedAt: Date | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function tidy(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function tidyMultiline(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\r\n/g, '\n').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function isStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > INTERVIEW_PREP_PROCESSING_STALE_MS;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

// ─── Fingerprinting ────────────────────────────────────────────────────────

function fingerprintFor(params: {
  pack: Pick<
    PackRow,
    | 'jobId'
    | 'company'
    | 'roleTitle'
    | 'location'
    | 'jobUrl'
    | 'jobDescription'
    | 'researchUrls'
    | 'companyWebsiteUrl'
    | 'careersUrl'
    | 'context'
    | 'interviewFormat'
    | 'interviewerInfo'
    | 'invitationNotes'
    | 'concerns'
    | 'focusTopics'
    | 'interviewLanguage'
  >;
  candidate: CandidateContext;
}): string {
  const { pack, candidate } = params;
  return hash(
    stableStringify({
      v: INTERVIEW_PREP_SCHEMA_VERSION,
      prompt: INTERVIEW_PREP_PROMPT_VERSION,
      jobId: pack.jobId,
      company: pack.company.trim(),
      roleTitle: pack.roleTitle.trim(),
      location: (pack.location ?? '').trim(),
      jobUrl: (pack.jobUrl ?? '').trim(),
      jobDescription: (pack.jobDescription ?? '').trim(),
      researchUrls: pack.researchUrls,
      companyWebsiteUrl: (pack.companyWebsiteUrl ?? '').trim(),
      careersUrl: (pack.careersUrl ?? '').trim(),
      context: pack.context,
      interviewFormat: pack.interviewFormat,
      interviewerInfo: (pack.interviewerInfo ?? '').trim(),
      invitationNotes: (pack.invitationNotes ?? '').trim(),
      concerns: (pack.concerns ?? '').trim(),
      focusTopics: pack.focusTopics,
      interviewLanguage: (pack.interviewLanguage ?? '').trim(),
      candidate: {
        profileVersion: candidate.profileVersion,
        resumeId: candidate.resumeId,
        resumeRevision: candidate.resumeRevision,
      },
    }),
  );
}

function dedupeKeyFor(params: {
  userId: string;
  jobId: string | null;
  company: string;
  roleTitle: string;
  jobUrl: string | null;
  fingerprint: string;
}): string {
  return hash(
    stableStringify({
      userId: params.userId,
      jobId: params.jobId,
      company: params.company.trim().toLowerCase(),
      roleTitle: params.roleTitle.trim().toLowerCase(),
      jobUrl: (params.jobUrl ?? '').trim().toLowerCase(),
      fingerprint: params.fingerprint,
    }),
  );
}

// ─── Summary / detail mapping ──────────────────────────────────────────────

function toSummary(row: PackRow, isFresh = true): PrepPackSummary {
  return {
    id: row.id,
    jobId: row.jobId,
    title: row.title,
    company: row.company,
    roleTitle: row.roleTitle,
    location: row.location,
    jobUrl: row.jobUrl,
    context: row.context,
    interviewAt: row.interviewAt,
    interviewFormat: row.interviewFormat,
    timing: row.timing,
    status: row.status,
    researchStatus: row.researchStatus,
    questionCount: row.questionCount,
    practicedCount: row.practicedCount,
    feedbackCount: row.feedbackCount,
    lastPracticedAt: row.lastPracticedAt,
    lastActivityAt: row.lastActivityAt,
    generatedAt: row.generatedAt,
    isFresh,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toResearchSourceView(row: {
  id: string;
  position: number;
  kind: string;
  url: string | null;
  canonicalUrl: string | null;
  title: string;
  publisher: string | null;
  publishedAt: Date | null;
  retrievedAt: Date | null;
  excerpt: string | null;
  summary: string | null;
  fetchStatus: string;
  verification: string;
  errorCode: string | null;
}): ResearchSourceView {
  return {
    id: row.id,
    position: row.position,
    kind: row.kind as ResearchSourceKind,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    publisher: row.publisher,
    publishedAt: row.publishedAt,
    retrievedAt: row.retrievedAt,
    excerpt: row.excerpt,
    summary: row.summary,
    fetchStatus: row.fetchStatus as ResearchSourceView['fetchStatus'],
    verification: row.verification as ResearchSourceView['verification'],
    errorCode: row.errorCode,
  };
}

function toTask(row: {
  id: string;
  taskKey: string;
  title: string;
  description: string;
  whyItMatters: string;
  expectedOutput: string;
  priority: string;
  category: string;
  estimatedMinutes: number;
  horizon: string;
  status: string;
  sortOrder: number;
  completedAt: Date | null;
}): PrepTask {
  return {
    id: row.id,
    taskKey: row.taskKey,
    title: row.title,
    description: row.description,
    whyItMatters: row.whyItMatters,
    expectedOutput: row.expectedOutput,
    priority: row.priority as Priority,
    category: row.category as TaskCategory,
    estimatedMinutes: row.estimatedMinutes,
    horizon: row.horizon as PrepHorizon,
    status: row.status as TaskStatus,
    sortOrder: row.sortOrder,
    completedAt: row.completedAt,
  };
}

/**
 * Session summaries written before scoring existed lack `averageScore` and
 * `scoredAttempts`. Normalise the JSON at the boundary so clients can rely on
 * the declared shape instead of rendering `undefined`.
 */
function toSessionSummary(value: unknown): PracticeSessionSummary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PracticeSessionSummary>;
  return {
    questionsAttempted: typeof raw.questionsAttempted === 'number' ? raw.questionsAttempted : 0,
    questionsWithFeedback: typeof raw.questionsWithFeedback === 'number' ? raw.questionsWithFeedback : 0,
    averageScore:
      typeof raw.averageScore === 'number' && Number.isFinite(raw.averageScore)
        ? raw.averageScore
        : null,
    scoredAttempts: typeof raw.scoredAttempts === 'number' ? raw.scoredAttempts : 0,
    strengths: Array.isArray(raw.strengths)
      ? raw.strengths.filter((item): item is string => typeof item === 'string')
      : [],
    priorities: Array.isArray(raw.priorities)
      ? raw.priorities.filter((item): item is string => typeof item === 'string')
      : [],
    dimensions: Array.isArray(raw.dimensions)
      ? (raw.dimensions as PracticeSessionSummary['dimensions'])
      : [],
    note: typeof raw.note === 'string' && raw.note.trim() ? raw.note : 'Session completed.',
  };
}

function toSession(row: {
  id: string;
  packId: string;
  mode: string;
  status: string;
  questionIds: unknown;
  summary: unknown;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}): PracticeSessionView {
  return {
    id: row.id,
    packId: row.packId,
    mode: row.mode,
    status: row.status,
    questionIds: asStringArray(row.questionIds),
    summary: toSessionSummary(row.summary),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Feedback written before scoring existed lacks `score`, `scoreRationale` and
 * `modelAnswer`. Normalise those keys to null so the UI never treats a missing
 * value as a real score or a complete evaluation.
 */
function toStoredFeedback(value: unknown): StoredFeedback | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<StoredFeedback>;
  return {
    score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : null,
    scoreRationale: typeof raw.scoreRationale === 'string' ? raw.scoreRationale : null,
    modelAnswer: typeof raw.modelAnswer === 'string' ? raw.modelAnswer : null,
    dimensions: Array.isArray(raw.dimensions)
      ? (raw.dimensions as StoredFeedback['dimensions'])
      : [],
    whatWorked: typeof raw.whatWorked === 'string' ? raw.whatWorked : '',
    needsImprovement: typeof raw.needsImprovement === 'string' ? raw.needsImprovement : '',
    missing: typeof raw.missing === 'string' ? raw.missing : '',
    structureSuggestion: typeof raw.structureSuggestion === 'string' ? raw.structureSuggestion : '',
    revisedStructure: typeof raw.revisedStructure === 'string' ? raw.revisedStructure : null,
    followUpPractice: Array.isArray(raw.followUpPractice)
      ? raw.followUpPractice.filter((item): item is string => typeof item === 'string')
      : [],
    adaptiveFollowUp:
      raw.adaptiveFollowUp && typeof raw.adaptiveFollowUp === 'object'
        ? (raw.adaptiveFollowUp as StoredFeedback['adaptiveFollowUp'])
        : null,
    limitations: typeof raw.limitations === 'string' ? raw.limitations : null,
  };
}

function toAttempt(row: {
  id: string;
  packId: string;
  questionId: string;
  sessionId: string | null;
  kind: string;
  parentAttemptId: string | null;
  followUpQuestion: string | null;
  questionVersion: number;
  attemptNumber: number;
  answer: string;
  feedback: unknown;
  rubricKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PracticeAttemptView {
  return {
    id: row.id,
    packId: row.packId,
    questionId: row.questionId,
    sessionId: row.sessionId,
    kind: row.kind,
    parentAttemptId: row.parentAttemptId,
    followUpQuestion: row.followUpQuestion,
    questionVersion: row.questionVersion,
    attemptNumber: row.attemptNumber,
    answer: row.answer,
    feedback: toStoredFeedback(row.feedback),
    rubricKey: row.rubricKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Feedback generated before scoring existed is still valid history, but it
 * cannot satisfy the score/model-answer contract. Only a complete scored
 * evaluation is reused idempotently.
 */
function isScoredFeedback(value: unknown): value is StoredFeedback {
  const feedback = toStoredFeedback(value);
  return Boolean(
    feedback &&
      feedback.score !== null &&
      feedback.scoreRationale &&
      feedback.modelAnswer &&
      Array.isArray(feedback.dimensions),
  );
}

// ─── Input assembly ─────────────────────────────────────────────────────────

type ResolvedPackInputs = {
  jobId: string | null;
  title: string;
  company: string;
  roleTitle: string;
  location: string | null;
  jobUrl: string | null;
  jobDescription: string;
  companyWebsiteUrl: string | null;
  careersUrl: string | null;
  interviewAt: Date | null;
  timing: PrepTiming;
  context: InterviewContext;
  interviewFormat: InterviewContext;
  interviewLanguage: string | null;
  interviewerInfo: string | null;
  invitationNotes: string | null;
  concerns: string | null;
  focusTopics: string[];
  researchUrls: string[];
  candidate: CandidateContext;
  inputFingerprint: string;
  dedupeKey: string;
};

async function resolveCreateInputs(input: CreatePrepPackInput): Promise<ResolvedPackInputs> {
  let job: {
    id: string;
    company: string;
    title: string;
    location: string | null;
    jobUrl: string | null;
    jobDescription: string | null;
  } | null = null;

  if (input.jobId) {
    job = await prisma.jobLead.findFirst({
      where: { id: input.jobId, userId: input.userId, deletedAt: null },
      select: { id: true, company: true, title: true, location: true, jobUrl: true, jobDescription: true },
    });
    if (!job) throw new InterviewPrepJobNotFoundError();
  }

  const company = tidy(input.company, 160) ?? job?.company ?? '';
  const roleTitle = tidy(input.roleTitle, 200) ?? job?.title ?? '';
  if (!company) throw new PrepValidationError('Add the employer name before creating a pack.');
  if (!roleTitle) throw new PrepValidationError('Add the role title before creating a pack.');

  const jobDescription =
    tidyMultiline(input.jobDescription, 60_000) ?? tidyMultiline(job?.jobDescription, 60_000) ?? '';

  if (!job && jobDescription.length < INTERVIEW_PREP_MIN_MANUAL_CHARS) {
    throw new PrepValidationError(
      'Add at least a few lines of the job description, or import the job URL, so the pack is grounded in the real role.',
      'NO_JOB_DATA',
    );
  }

  const interviewAt = input.interviewAt ?? null;
  if (interviewAt && Number.isNaN(interviewAt.getTime())) {
    throw new PrepValidationError('That interview date is not valid.');
  }

  const requestedTiming = input.timing ?? 'UNKNOWN';
  const timing = resolveHorizon({ interviewAt, timing: requestedTiming });
  const context = input.context ?? input.interviewFormat ?? 'BALANCED';
  const interviewFormat = input.interviewFormat ?? input.context ?? 'BALANCED';

  const candidate = await buildCandidateContext({ userId: input.userId, jobId: job?.id ?? null });

  const researchUrls = (input.researchUrls ?? [])
    .map((url) => tidy(url, 2_048))
    .filter((url): url is string => Boolean(url))
    .slice(0, INTERVIEW_PREP_MAX_RESEARCH_URLS);

  const base: Omit<ResolvedPackInputs, 'inputFingerprint' | 'dedupeKey'> = {
    jobId: job?.id ?? null,
    title:
      tidy(input.title, 160) ??
      `${company} — ${roleTitle}${context === 'BALANCED' ? '' : ` (${context.replace(/_/g, ' ').toLowerCase()})`}`,
    company,
    roleTitle,
    location: tidy(input.location, 200) ?? job?.location ?? null,
    jobUrl: tidy(input.jobUrl, 2_048) ?? job?.jobUrl ?? null,
    jobDescription,
    researchUrls,
    companyWebsiteUrl: tidy(input.companyWebsiteUrl, 2_048),
    careersUrl: tidy(input.careersUrl, 2_048),
    interviewAt,
    timing,
    context,
    interviewFormat,
    interviewLanguage: tidy(input.interviewLanguage, 80),
    interviewerInfo: tidyMultiline(input.interviewerInfo, 2_000),
    invitationNotes: tidyMultiline(input.invitationNotes, 2_000),
    concerns: tidyMultiline(input.concerns, 1_200),
    focusTopics: (input.focusTopics ?? [])
      .map((topic) => tidy(topic, 120))
      .filter((topic): topic is string => Boolean(topic))
      .slice(0, 8),
    candidate,
  };

  const inputFingerprint = fingerprintFor({ pack: base, candidate });
  const dedupeKey = dedupeKeyFor({
    userId: input.userId,
    jobId: base.jobId,
    company: base.company,
    roleTitle: base.roleTitle,
    jobUrl: base.jobUrl,
    fingerprint: inputFingerprint,
  });

  return { ...base, inputFingerprint, dedupeKey };
}

/**
 * Find the pack that represents one exact input set.
 *
 * `dedupeKey` is the primary lookup, but two kinds of rows only match on the
 * composite `(userId, jobId, inputFingerprint)` identity:
 *
 *  - rows created before `dedupeKey` existed, whose key was backfilled to the
 *    row id by the intelligence migration; and
 *  - rows whose fingerprint moved during a regeneration but whose key did not
 *    (older builds updated one column without the other).
 *
 * Falling back to the composite lookup keeps those rows reusable instead of
 * turning a duplicate into a 500 from the composite unique index.
 */
async function findPackByIdentity(params: {
  userId: string;
  jobId: string | null;
  inputFingerprint: string;
  dedupeKey: string;
}): Promise<PackRow | null> {
  const byKey = await prisma.interviewPrepPack.findUnique({
    where: { dedupeKey: params.dedupeKey },
  });
  if (byKey) return byKey as PackRow;

  const byInputs = await prisma.interviewPrepPack.findFirst({
    where: {
      userId: params.userId,
      jobId: params.jobId,
      inputFingerprint: params.inputFingerprint,
    },
    orderBy: { updatedAt: 'desc' },
  });
  return (byInputs as PackRow | null) ?? null;
}

/**
 * Bring a legacy row's `dedupeKey` in line with the fingerprint it now stores.
 * The write is best-effort: if another row already owns the canonical key, the
 * row we matched is still the correct pack for this request.
 */
async function adoptDedupeKey(row: PackRow, dedupeKey: string): Promise<PackRow> {
  if (row.dedupeKey === dedupeKey) return row;

  try {
    return (await prisma.interviewPrepPack.update({
      where: { id: row.id },
      data: {
        dedupeKey,
        // A key repair must not move the processing-staleness clock.
        updatedAt: row.updatedAt,
      },
    })) as PackRow;
  } catch (error) {
    if (!hasPrismaUniqueViolation(error)) throw error;
    return row;
  }
}

/**
 * Decide whether an existing row already answers this request. A row that is
 * mid-generation is a conflict; a completed row is reused without charging;
 * a draft or failed row is handed back so the caller can generate it.
 *
 * This same rule applies to the insert-race path, so two simultaneous creates
 * cannot make the loser report an empty draft as a finished pack.
 */
function reuseExisting(row: PackRow, force: boolean): { reused: boolean } {
  if (
    (row.status === 'RESEARCHING' || row.status === 'GENERATING') &&
    !isStale(row.updatedAt) &&
    !force
  ) {
    throw new DuplicatePrepGenerationInFlightError();
  }

  return {
    reused:
      !force &&
      (row.status === 'READY' || row.status === 'PARTIALLY_READY') &&
      Boolean(row.content),
  };
}

/**
 * Create or reuse a pack row. This is intentionally cheap: no provider call.
 * The route decides whether to generate immediately or leave the pack as a
 * draft the candidate can review first.
 */
export async function createPrepPack(input: CreatePrepPackInput): Promise<CreatePrepPackResult> {
  const inputs = await resolveCreateInputs(input);

  const existing = await findPackByIdentity({
    userId: input.userId,
    jobId: inputs.jobId,
    inputFingerprint: inputs.inputFingerprint,
    dedupeKey: inputs.dedupeKey,
  });
  if (existing) {
    const { reused } = reuseExisting(existing, input.force === true);
    const row = await adoptDedupeKey(existing, inputs.dedupeKey);
    return { pack: toSummary(row, true), reused };
  }

  try {
    const created = await prisma.interviewPrepPack.create({
      data: {
        userId: input.userId,
        jobId: inputs.jobId,
        title: inputs.title,
        company: inputs.company,
        roleTitle: inputs.roleTitle,
        location: inputs.location,
        jobUrl: inputs.jobUrl,
        jobDescription: inputs.jobDescription || null,
        researchUrls: inputs.researchUrls,
        companyWebsiteUrl: inputs.companyWebsiteUrl,
        careersUrl: inputs.careersUrl,
        interviewerInfo: inputs.interviewerInfo,
        interviewLanguage: inputs.interviewLanguage,
        invitationNotes: inputs.invitationNotes,
        concerns: inputs.concerns,
        focusTopics: inputs.focusTopics,
        interviewAt: inputs.interviewAt,
        interviewFormat: inputs.interviewFormat,
        timing: inputs.timing,
        context: inputs.context,
        status: 'DRAFT',
        researchStatus: 'NOT_STARTED',
        schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
        promptVersion: INTERVIEW_PREP_PROMPT_VERSION,
        inputFingerprint: inputs.inputFingerprint,
        dedupeKey: inputs.dedupeKey,
        limitations: [],
      },
    });
    return { pack: toSummary(created as PackRow, true), reused: false };
  } catch (error) {
    if (!hasPrismaUniqueViolation(error)) throw error;
    const raced = await findPackByIdentity({
      userId: input.userId,
      jobId: inputs.jobId,
      inputFingerprint: inputs.inputFingerprint,
      dedupeKey: inputs.dedupeKey,
    });
    if (!raced) throw error;
    const row = await adoptDedupeKey(raced, inputs.dedupeKey);
    const { reused } = reuseExisting(row, input.force === true);
    return { pack: toSummary(row, true), reused };
  }
}

/** Create and immediately generate. Used by the job detail one-click flow. */
export async function createAndGeneratePrepPack(
  input: CreatePrepPackInput & { route: string; provider?: InterviewPrepAiProvider },
): Promise<RunPrepGenerationResult> {
  const created = await createPrepPack(input);
  if (created.reused) {
    const detail = await getPrepPack({ userId: input.userId, packId: created.pack.id });
    if (!detail) {
      return {
        outcome: 'FAILED',
        pack: null,
        code: 'AI_UNAVAILABLE',
        message: INTERVIEW_PREP_ERROR_MESSAGES.AI_UNAVAILABLE,
        retryable: true,
      };
    }
    return { outcome: 'REUSED', pack: detail.pack, data: detail.data };
  }
  return generatePrepPack({
    userId: input.userId,
    packId: created.pack.id,
    force: input.force === true,
    provider: input.provider,
    route: input.route,
  });
}

// ─── Research helpers ──────────────────────────────────────────────────────

function buildSourceBlock(sources: ResearchSource[]): string {
  const blocks: string[] = [];
  let total = 0;
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!source.text.trim()) continue;
    const text = source.text.slice(0, Math.min(2_400, INTERVIEW_PREP_MAX_SOURCE_TEXT_CHARS));
    const block = [
      `[S${index}] ${source.kind} — ${source.title}`,
      source.url ? `URL: ${source.url}` : 'URL: supplied by the candidate',
      source.publishedAt ? `Published: ${source.publishedAt.toISOString().slice(0, 10)}` : null,
      'CONTENT:',
      text,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
    if (total + block.length > 24_000) break;
    total += block.length;
    blocks.push(block);
  }
  return blocks.join('\n\n---\n\n');
}

function buildPackBlock(params: {
  pack: PackRow;
  horizon: PrepHorizon;
  familyLabel: string;
  researchStatus: ResearchStatus;
}): string {
  const { pack } = params;
  const lines = [
    `Employer: ${pack.company}`,
    `Role: ${pack.roleTitle}`,
    pack.location ? `Location: ${pack.location}` : 'Location: not supplied',
    pack.jobUrl ? `Job URL: ${pack.jobUrl}` : null,
    `Interview context: ${pack.context}`,
    `Interview format: ${pack.interviewFormat}`,
    `Preparation horizon: ${params.horizon}`,
    pack.interviewAt ? `Interview date: ${pack.interviewAt.toISOString()}` : 'Interview date: not supplied',
    pack.interviewLanguage ? `Preferred output language: ${pack.interviewLanguage}` : null,
    `Occupational family (heuristic): ${params.familyLabel}`,
    `Research status: ${params.researchStatus}`,
    pack.invitationNotes ? `Invitation notes supplied by the candidate: ${pack.invitationNotes}` : null,
    pack.interviewerInfo ? `Interviewer details supplied by the candidate: ${pack.interviewerInfo}` : null,
    pack.concerns ? `Candidate concerns: ${pack.concerns}` : null,
    pack.focusTopics.length ? `Candidate focus topics: ${pack.focusTopics.join(', ')}` : null,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

async function persistResearchSources(packId: string, sources: ResearchSource[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.interviewResearchSource.deleteMany({ where: { packId } });
    if (sources.length === 0) return;
    await tx.interviewResearchSource.createMany({
      data: sources.map((source, position) => ({
        packId,
        position,
        kind: source.kind,
        url: source.url,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        publisher: source.publisher,
        publishedAt: source.publishedAt,
        retrievedAt: source.retrievedAt,
        excerpt: source.excerpt,
        summary: source.summary,
        fetchStatus: source.fetchStatus,
        verification: source.verification,
        errorCode: source.errorCode,
      })),
    });
  }, { timeout: 20_000 });
}

// ─── Generation ────────────────────────────────────────────────────────────

export type RunPrepGenerationOptions = {
  /** Server-derived. Never read from a request body. */
  userId: string;
  packId: string;
  force?: boolean;
  route: string;
  /** Injected by tests; production always resolves the configured provider. */
  provider?: InterviewPrepAiProvider;
};

export async function generatePrepPack(options: RunPrepGenerationOptions): Promise<RunPrepGenerationResult> {
  const { userId, packId, route } = options;

  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, INTERVIEW_PREP_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'interview_entitlement_denied',
      userId,
      route,
      context: { feature: INTERVIEW_PREP_FEATURE, packId },
    });
    throw error;
  }

  let row = (await prisma.interviewPrepPack.findFirst({ where: { id: packId, userId } })) as PackRow | null;
  if (!row) throw new InterviewPrepPackNotFoundError();

  if (row.status === 'ARCHIVED') {
    // Regenerating an archived pack is allowed only if the caller explicitly
    // unarchives it first; this prevents accidental spend from a stale tab.
    throw new InterviewPrepPackNotFoundError();
  }

  if ((row.status === 'RESEARCHING' || row.status === 'GENERATING') && !isStale(row.updatedAt)) {
    throw new DuplicatePrepGenerationInFlightError();
  }

  // Resolve the job description from the URL when the candidate has not pasted
  // one. This is the only implicit fetch in generation, and it is bounded.
  if ((row.jobDescription ?? '').trim().length < 40 && row.jobUrl) {
    try {
      const imported = await importJobPosting(row.jobUrl);
      row = (await prisma.interviewPrepPack.update({
        where: { id: row.id },
        data: { jobDescription: imported.description },
      })) as PackRow;
    } catch {
      await markFailed(row.id, 'JOB_URL_UNREACHABLE');
      return failureFor(row.id, 'JOB_URL_UNREACHABLE', false);
    }
  }

  if ((row.jobDescription ?? '').trim().length < 40) {
    await markFailed(row.id, 'NO_JOB_DATA');
    await logImportantInfo({
      event: 'interview_prep_failed',
      userId,
      route,
      context: { packId, code: 'NO_JOB_DATA' },
    });
    return failureFor(row.id, 'NO_JOB_DATA', false);
  }

  const candidate = await buildCandidateContext({ userId, jobId: row.jobId });
  const currentFingerprint = fingerprintFor({ pack: row, candidate });
  // The key and the fingerprint describe the same identity. Keep them in step
  // whenever regeneration stores a new fingerprint; otherwise a later create
  // finds the old key and collides with the composite unique index.
  const currentDedupeKey = dedupeKeyFor({
    userId: row.userId,
    jobId: row.jobId,
    company: row.company,
    roleTitle: row.roleTitle,
    jobUrl: row.jobUrl,
    fingerprint: currentFingerprint,
  });

  if (!options.force && currentFingerprint === row.inputFingerprint && row.content) {
    if (row.status === 'READY' || row.status === 'PARTIALLY_READY') {
      const detail = await getPrepPack({ userId, packId });
      if (!detail) throw new InterviewPrepPackNotFoundError();
      return { outcome: 'REUSED', pack: detail.pack, data: detail.data };
    }
  }

  // If the current inputs now match a sibling pack, regenerating this row
  // cannot persist the new fingerprint (or key) without violating a unique
  // index. Fail before spending a credit and point at the pack that already
  // covers these inputs.
  const identityCollision = await prisma.interviewPrepPack.findFirst({
    where: {
      id: { not: row.id },
      userId,
      OR: [
        { dedupeKey: currentDedupeKey },
        { jobId: row.jobId, inputFingerprint: currentFingerprint },
      ],
    },
    select: { id: true },
  });
  if (identityCollision) {
    throw new PrepValidationError(
      'Another preparation pack already covers these exact inputs. Open that pack instead, or change the interview context or job details before regenerating this one.',
      'INVALID_PREP_REQUEST',
    );
  }

  const researchUrls = normaliseResearchUrlsFromRow(row);

  await prisma.interviewPrepPack.update({
    where: { id: row.id },
    data: {
      status: 'RESEARCHING',
      researchStatus: 'NOT_STARTED',
      errorCode: null,
      lastActivityAt: new Date(),
    },
  });

  const research = await buildResearchBundle({
    jobDescription: row.jobDescription,
    companyWebsiteUrl: row.companyWebsiteUrl,
    careersUrl: row.careersUrl,
    researchUrls,
  });

  await persistResearchSources(row.id, research.sources);

  const researchStatus: ResearchStatus = research.status;
  const sourceRows = await prisma.interviewResearchSource.findMany({
    where: { packId: row.id },
    orderBy: { position: 'asc' },
    select: { id: true, position: true },
  });
  const sourceIdByPosition = new Map(sourceRows.map((source) => [source.position, source.id]));

  const verificationSources: VerificationSource[] = research.sources.map((source, index) => ({
    index,
    kind: source.kind,
    title: source.title,
    url: source.url,
    text: source.text,
  }));

  const family = classifyRole({ title: row.roleTitle, description: row.jobDescription });
  const horizon = resolveHorizon({
    interviewAt: row.interviewAt,
    timing: row.timing as PrepTiming,
  });

  const packBlock = buildPackBlock({
    pack: row,
    horizon,
    familyLabel: family.label,
    researchStatus,
  });

  await prisma.interviewPrepPack.update({
    where: { id: row.id },
    data: {
      status: 'GENERATING',
      researchStatus,
      researchSummary:
        researchStatus === 'COMPLETED'
          ? `${research.fetchedCount} of ${research.attemptedCount} research source${research.attemptedCount === 1 ? '' : 's'} read.`
          : researchStatus === 'PARTIAL'
            ? `${research.fetchedCount} of ${research.attemptedCount} research sources read; some could not be used.`
            : researchStatus === 'NOT_AVAILABLE'
              ? 'No official company sources were supplied.'
              : 'The supplied company sources could not be read.',
      researchErrorCode: research.errorCodes[0] ?? null,
      lastActivityAt: new Date(),
    },
  });

  await logImportantInfo({
    event: 'interview_pack_generation_started',
    userId,
    jobId: row.jobId ?? undefined,
    route,
    context: {
      packId: row.id,
      force: options.force === true,
      context: row.context,
      researchStatus,
      sources: research.sources.length,
      profileCompleteness: candidate.completeness,
      hadResume: candidate.resumeId !== null,
      horizon,
    },
  });

  // Resolve the provider before charging: a missing or invalid configuration
  // must never consume a credit for a request that cannot be attempted.
  let provider: InterviewPrepAiProvider;
  try {
    provider = options.provider ?? resolveInterviewPrepAiProvider();
  } catch (error) {
    await markFailed(row.id, 'AI_NOT_CONFIGURED');
    return failureFor(row.id, 'AI_NOT_CONFIGURED', false);
  }

  // Usage is reserved immediately before the provider call. A duplicate
  // idempotency key means this exact input set was already charged.
  const idempotencyKey = options.force
    ? `interview-prep:${row.id}:${Date.now()}`
    : `interview-prep:${row.id}:${currentFingerprint}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    await logImportantInfo({
      event: 'interview_prep_admin_bypass',
      userId,
      route,
      context: { packId: row.id, operation: 'generate' },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, INTERVIEW_PREP_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      await markFailed(row.id, 'AI_UNAVAILABLE');
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'interview_usage_denied',
          userId,
          route,
          context: { packId: row.id, feature: INTERVIEW_PREP_FEATURE, limit: error.limit, used: error.used },
        });
      }
      throw error;
    }
  }

  let verified: ReturnType<typeof verifyPack>;
  try {
    const modelPack = await provider.generatePack({
      packBlock,
      candidateBlock: candidate.profileText,
      sourceBlock: buildSourceBlock(research.sources),
      jobText: (row.jobDescription ?? '').slice(0, 40_000),
      context: row.context as InterviewContext,
      track: interviewTrackForContext(row.context as InterviewContext),
      horizon,
      maxQuestions: INTERVIEW_PREP_MAX_QUESTIONS,
      maxTasks: INTERVIEW_PREP_MAX_TASKS,
      language: row.interviewLanguage,
    });

    const profileEvidence: ProfileEvidence = {
      projectNames: candidate.projectNames,
      experienceTitles: candidate.experienceTitles,
      skillNames: candidate.skillNames,
    };

    verified = verifyPack({
      pack: modelPack,
      sources: verificationSources,
      jobText: row.jobDescription ?? '',
      candidateText: candidate.evidenceText,
      profile: profileEvidence,
      maxQuestions: INTERVIEW_PREP_MAX_QUESTIONS,
      maxTasks: INTERVIEW_PREP_MAX_TASKS,
    });
  } catch (error) {
    const code = error instanceof InterviewPrepAiError ? error.code : 'AI_INVALID_RESPONSE';
    await markFailed(row.id, code);
    if (error instanceof InterviewPrepAiError) {
      await logImportantError({
        event: 'interview_pack_generation_failed',
        userId,
        jobId: row.jobId ?? undefined,
        route,
        error,
        context: { packId: row.id, code: error.code },
      });
      return failureFor(row.id, error.code as InterviewPrepErrorCode, error.retryable);
    }
    await logImportantError({
      event: 'interview_pack_generation_failed',
      userId,
      jobId: row.jobId ?? undefined,
      route,
      error,
      context: { packId: row.id, code },
    });
    return failureFor(row.id, 'AI_INVALID_RESPONSE', true);
  }

  // Deterministic plan enrichment. Model tasks win; fallback tasks fill gaps
  // so an imminent interview always has a usable plan.
  const fallback = fallbackTasks({
    horizon,
    context: row.context as InterviewContext,
    roleTitle: row.roleTitle,
    company: row.company,
    researchAvailable: researchStatus === 'COMPLETED' || researchStatus === 'PARTIAL',
    hasCandidateEvidence: candidate.hasEvidence,
    hadInterviewerInfo: Boolean(row.interviewerInfo),
    concerns: row.concerns,
  });

  const byKey = new Map<string, (typeof verified.pack.tasks)[number]>();
  for (const task of verified.pack.tasks) byKey.set(task.taskKey, task);
  for (const task of fallback) {
    if (!byKey.has(task.taskKey)) byKey.set(task.taskKey, task);
  }
  const finalTasks = sortTasks([...byKey.values()]).slice(0, INTERVIEW_PREP_MAX_TASKS);

  const content: PrepContent = {
    briefing: verified.pack.briefing,
    company: {
      ...verified.pack.company,
      researchStatus,
      sourceCount: research.sources.length,
      fetchedSourceCount: research.fetchedCount,
    },
    role: {
      ...verified.pack.role,
      occupationalFamily: family.label,
    },
    evidenceBank: verified.pack.evidenceBank,
    employerQuestions: verified.pack.employerQuestions,
    logistics: verified.pack.logistics,
    cheatSheet: {
      ...verified.pack.cheatSheet,
      companyName: row.company,
      roleTitle: row.roleTitle,
      interviewAt: row.interviewAt ? row.interviewAt.toISOString() : null,
      generatedNote: 'Generated from the job description, your profile and the sources you supplied. Verify details before relying on them.',
    },
  };

  const questions =
    verified.pack.questions.length > 0
      ? verified.pack.questions
      : [];

  const partiallyReady =
    questions.length < INTERVIEW_PREP_MIN_USEFUL_QUESTIONS ||
    finalTasks.length < Math.min(INTERVIEW_PREP_MIN_TASKS, 2) ||
    (!content.company.overview &&
      content.company.products.length === 0 &&
      content.company.mission === null &&
      researchStatus === 'COMPLETED');
  const status: PackStatus = partiallyReady ? 'PARTIALLY_READY' : 'READY';

  const limitations = [
    ...new Set([
      ...verified.pack.limitations,
      ...research.limitations,
      ...(questions.length < INTERVIEW_PREP_MIN_USEFUL_QUESTIONS
        ? ['The question bank is smaller than usual because the source material was thin.']
        : []),
      ...(candidate.completeness === 'EMPTY' || candidate.completeness === 'MINIMAL'
        ? ['Your career evidence is thin, so personalisation is limited. Add projects or experience to improve it.']
        : []),
    ]),
  ].slice(0, 12);

  const maxVersion = await prisma.interviewQuestion.aggregate({ where: { packId: row.id }, _max: { version: true } });
  const nextVersion = (maxVersion._max.version ?? 0) + 1;

  // A regeneration rewrites up to ten tasks and the whole question bank. The
  // default 5s interactive-transaction budget is too tight on a loaded
  // database, so allow the bounded write batch to finish without timing out.
  const completed = await prisma.$transaction(async (tx) => {
    await tx.interviewQuestion.updateMany({ where: { packId: row.id, isActive: true }, data: { isActive: false } });

    if (questions.length > 0) {
      await tx.interviewQuestion.createMany({
        data: questions.map((question, ordinal) => ({
          packId: row.id,
          version: nextVersion,
          ordinal,
          category: question.category,
          difficulty: question.difficulty,
          competency: question.competency,
          question: question.question,
          whyMatters: question.whyMatters,
          relatedRequirement: question.relatedRequirement,
          relevantExperience: question.candidateEvidenceNote,
          prepNotes: question.prepNotes,
          answerStructure: question.answerStructure as AnswerStructure | null,
          followUpQuestionIds: question.followUpQuestions,
          sourceType: 'GENERATED' as SourceType,
          sourceEvidence: question.relatedRequirement,
          priority: question.priority,
          evidenceBasis: question.evidenceBasis,
          strongAnswerShows: question.strongAnswerShows,
          commonPitfalls: question.commonPitfalls,
          coaching: question.coaching as unknown as Prisma.InputJsonValue,
          sourceRefs: question.sourceIndexes
            .map((index) => sourceIdByPosition.get(index))
            .filter((value): value is string => Boolean(value)),
          isPrediction: true,
          isActive: true,
        })),
      });
    }

    // Preserve completion across regeneration by taskKey.
    const existingTasks = await tx.interviewPrepTask.findMany({ where: { packId: row.id } });
    const existingByKey = new Map(existingTasks.map((task) => [task.taskKey, task]));

    for (let index = 0; index < finalTasks.length; index += 1) {
      const task = finalTasks[index];
      const existing = existingByKey.get(task.taskKey);
      if (existing) {
        await tx.interviewPrepTask.update({
          where: { id: existing.id },
          data: {
            title: task.title,
            description: task.description,
            whyItMatters: task.whyItMatters,
            expectedOutput: task.expectedOutput,
            priority: task.priority,
            category: task.category,
            estimatedMinutes: task.estimatedMinutes,
            horizon: task.horizon,
            sortOrder: index,
          },
        });
      } else {
        await tx.interviewPrepTask.create({
          data: {
            packId: row.id,
            taskKey: task.taskKey,
            title: task.title,
            description: task.description,
            whyItMatters: task.whyItMatters,
            expectedOutput: task.expectedOutput,
            priority: task.priority,
            category: task.category,
            estimatedMinutes: task.estimatedMinutes,
            horizon: task.horizon,
            sortOrder: index,
          },
        });
      }
    }

    const keepKeys = finalTasks.map((task) => task.taskKey);
    await tx.interviewPrepTask.deleteMany({
      where: { packId: row.id, taskKey: { notIn: keepKeys }, status: { not: 'COMPLETED' } },
    });

    return tx.interviewPrepPack.update({
      where: { id: row.id },
      data: {
        status,
        title: verified.pack.title || row.title,
        // The user's selected context is the source of truth. Provider output
        // must never silently move a pack into a different interview type.
        context: row.context,
        content: content as unknown as Prisma.InputJsonValue,
        preparationGuidance: verified.pack.preparationGuidance,
        limitations,
        questionCount: questions.length,
        researchStatus,
        researchSummary:
          researchStatus === 'COMPLETED'
            ? `${research.fetchedCount} of ${research.attemptedCount} research sources read.`
            : researchStatus === 'NOT_AVAILABLE'
              ? 'No official company sources were supplied.'
              : `${research.fetchedCount} of ${research.attemptedCount} research sources read.`,
        researchErrorCode: research.errorCodes[0] ?? null,
        inputFingerprint: currentFingerprint,
        dedupeKey: currentDedupeKey,
        schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
        promptVersion: INTERVIEW_PREP_PROMPT_VERSION,
        generatedAt: new Date(),
        lastActivityAt: new Date(),
        errorCode: null,
      },
    });
  }, { timeout: 20_000 });

  await updatePackProgress(row.id);

  await logImportantInfo({
    event: 'interview_pack_created',
    userId,
    jobId: row.jobId ?? undefined,
    route,
    context: {
      packId: row.id,
      model: provider.model,
      questions: questions.length,
      tasks: finalTasks.length,
      sources: research.sources.length,
      context: row.context,
      track: interviewTrackForContext(row.context as InterviewContext),
      researchStatus,
      creditsConsumed,
      status,
      companyClaimsDropped: verified.stats.companyClaimsDropped,
    },
  });

  const detail = await getPrepPack({ userId, packId: row.id });
  if (!detail) {
    return {
      outcome: 'FAILED',
      pack: toSummary(completed as PackRow, false),
      code: 'AI_UNAVAILABLE',
      message: INTERVIEW_PREP_ERROR_MESSAGES.AI_UNAVAILABLE,
      retryable: true,
    };
  }

  return { outcome: 'COMPLETED', pack: detail.pack, data: detail.data, creditsConsumed };
}

function normaliseResearchUrlsFromRow(row: PackRow): string[] {
  return row.researchUrls;
}

async function markFailed(packId: string, errorCode: string): Promise<void> {
  await prisma.interviewPrepPack
    .update({ where: { id: packId }, data: { status: 'FAILED', errorCode, lastActivityAt: new Date() } })
    .catch(() => undefined);
}

function failureFor(
  _packId: string,
  code: InterviewPrepErrorCode,
  retryable: boolean,
): RunPrepGenerationResult {
  return {
    outcome: 'FAILED',
    pack: null,
    code,
    message: INTERVIEW_PREP_ERROR_MESSAGES[code] ?? INTERVIEW_PREP_ERROR_MESSAGES.AI_UNAVAILABLE,
    retryable,
  };
}

// ─── Reading ───────────────────────────────────────────────────────────────

function toPackData(params: {
  row: PackRow;
  questions: Array<{
    id: string;
    version: number;
    ordinal: number;
    category: string;
    difficulty: string;
    competency: string;
    question: string;
    whyMatters: string | null;
    relatedRequirement: string | null;
    relevantExperience: string | null;
    prepNotes: string | null;
    answerStructure: string | null;
    followUpQuestionIds: unknown;
    sourceType: string;
    sourceEvidence: string | null;
    priority: string;
    evidenceBasis: string;
    strongAnswerShows: string | null;
    commonPitfalls: unknown;
    coaching: unknown;
    sourceRefs: unknown;
    isPrediction: boolean;
    isActive: boolean;
  }>;
  content: PrepContent | null;
}): InterviewPrepPackData {
  const { row, questions, content } = params;
  return {
    id: row.id,
    userId: row.userId,
    jobId: row.jobId,
    title: row.title,
    company: row.company,
    roleTitle: row.roleTitle,
    location: row.location,
    jobUrl: row.jobUrl,
    context: row.context as InterviewContext,
    interviewAt: row.interviewAt,
    interviewFormat: row.interviewFormat as InterviewContext,
    timing: row.timing as PrepTiming,
    interviewLanguage: row.interviewLanguage,
    interviewerInfo: row.interviewerInfo,
    concerns: row.concerns,
    focusTopics: row.focusTopics,
    companyWebsiteUrl: row.companyWebsiteUrl,
    careersUrl: row.careersUrl,
    status: row.status as PackStatus,
    researchStatus: row.researchStatus as ResearchStatus,
    schemaVersion: row.schemaVersion,
    promptVersion: row.promptVersion,
    inputFingerprint: row.inputFingerprint,
    content,
    questions: questions.map((question) => ({
      id: question.id,
      version: question.version,
      ordinal: question.ordinal,
      category: question.category as QuestionCategory,
      difficulty: question.difficulty as Difficulty,
      competency: question.competency,
      question: question.question,
      whyMatters: question.whyMatters ?? '',
      relatedRequirement: question.relatedRequirement,
      relevantExperience: question.relevantExperience,
      prepNotes: question.prepNotes,
      answerStructure: question.answerStructure as AnswerStructure | null,
      followUpQuestionIds: asStringArray(question.followUpQuestionIds),
      sourceType: question.sourceType as SourceType,
      sourceEvidence: question.sourceEvidence,
      priority: question.priority as Priority,
      evidenceBasis: question.evidenceBasis as InterviewPrepPackData['questions'][number]['evidenceBasis'],
      strongAnswerShows: question.strongAnswerShows,
      commonPitfalls: asStringArray(question.commonPitfalls),
      coaching: (question.coaching as InterviewPrepPackData['questions'][number]['coaching']) ?? null,
      sourceRefs: asStringArray(question.sourceRefs),
      isPrediction: question.isPrediction,
      isActive: question.isActive,
    })),
    preparationGuidance: row.preparationGuidance,
    limitations: row.limitations,
  };
}

/**
 * Load one pack the caller owns, with everything the workspace needs.
 *
 * Ownership is part of the query so another user's pack is a 404, not a 403.
 * Reading never consumes AI credits.
 */
export async function getPrepPack(params: {
  userId: string;
  packId: string;
}): Promise<PrepPackDetail | null> {
  const row = (await prisma.interviewPrepPack.findFirst({
    where: { id: params.packId, userId: params.userId },
    include: {
      questions: { where: { isActive: true }, orderBy: { ordinal: 'asc' } },
      sources: { orderBy: { position: 'asc' } },
      tasks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      sessions: { orderBy: { updatedAt: 'desc' }, take: 20 },
    },
  })) as
    | (PackRow & {
        questions: Parameters<typeof toPackData>[0]['questions'];
        sources: Array<Parameters<typeof toResearchSourceView>[0]>;
        tasks: Array<Parameters<typeof toTask>[0]>;
        sessions: Array<Parameters<typeof toSession>[0]>;
      })
    | null;
  if (!row) return null;

  const attempts = await prisma.interviewPracticeAttempt.findMany({
    where: { packId: row.id, userId: params.userId },
    select: { questionId: true, feedback: true },
  });

  const content = (row.content as PrepContent | null) ?? null;
  const tasks = row.tasks.map(toTask);
  const sources = row.sources.map(toResearchSourceView);
  const sessions = row.sessions.map(toSession);

  const readiness = calculateReadiness({
    content,
    questions: row.questions.map((question) => ({
      id: question.id,
      category: question.category,
      priority: question.priority,
    })),
    tasks,
    attempts,
    sessions,
    researchStatus: row.researchStatus as ResearchStatus,
    sourcesAvailable: sources.filter((source) => source.fetchStatus === 'FETCHED').length,
  });

  let isFresh = true;
  if (row.status === 'READY' || row.status === 'PARTIALLY_READY') {
    try {
      const candidate = await buildCandidateContext({ userId: params.userId, jobId: row.jobId });
      isFresh = fingerprintFor({ pack: row, candidate }) === row.inputFingerprint;
    } catch {
      isFresh = true;
    }
  }

  const data = toPackData({ row, questions: row.questions, content });
  return {
    pack: toSummary(row, isFresh),
    data,
    sources,
    tasks,
    sessions,
    readiness,
    practicedQuestionIds: [...new Set(attempts.map((attempt) => attempt.questionId))],
    feedbackQuestionIds: [
      ...new Set(attempts.filter((attempt) => attempt.feedback !== null).map((attempt) => attempt.questionId)),
    ],
  };
}

/** Backwards-compatible alias used by earlier callers. */
export const getPackWithQuestions = getPrepPack;

export async function listPrepPacks(params: {
  userId: string;
  jobId?: string;
  includeArchived?: boolean;
}): Promise<PrepPackSummary[]> {
  const rows = (await prisma.interviewPrepPack.findMany({
    where: {
      userId: params.userId,
      ...(params.jobId ? { jobId: params.jobId } : {}),
      ...(params.includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
    },
    orderBy: [{ lastActivityAt: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
  })) as PackRow[];
  return rows.map((row) => toSummary(row, true));
}

export async function getPrepProgress(params: {
  userId: string;
  packId: string;
}): Promise<PrepProgress | null> {
  const detail = await getPrepPack(params);
  if (!detail) return null;

  const attempts = await prisma.interviewPracticeAttempt.findMany({
    where: { packId: params.packId, userId: params.userId },
    select: { questionId: true, feedback: true },
  });
  const answered = new Set(attempts.map((attempt) => attempt.questionId));

  return {
    packId: detail.pack.id,
    questionCount: detail.pack.questionCount,
    answeredCount: answered.size,
    practicedCount: detail.pack.practicedCount,
    feedbackCount: detail.pack.feedbackCount,
    outstandingCount: Math.max(0, detail.pack.questionCount - answered.size),
    taskCount: detail.tasks.length,
    tasksCompleted: detail.tasks.filter((task) => task.status === 'COMPLETED').length,
    mockSessionsCompleted: detail.sessions.filter((session) => session.status === 'COMPLETED').length,
    lastPracticedAt: detail.pack.lastPracticedAt,
    readiness: detail.readiness,
  };
}

// ─── Updates and plan recalculation ────────────────────────────────────────

export type UpdatePrepPackInput = {
  title?: string;
  context?: InterviewContext;
  interviewFormat?: InterviewContext;
  interviewAt?: Date | null;
  timing?: PrepTiming;
  interviewerInfo?: string | null;
  invitationNotes?: string | null;
  concerns?: string | null;
  focusTopics?: string[];
  interviewLanguage?: string | null;
  companyWebsiteUrl?: string | null;
  careersUrl?: string | null;
  researchUrls?: string[];
  jobUrl?: string | null;
  jobDescription?: string | null;
  company?: string;
  roleTitle?: string;
  location?: string | null;
  status?: 'ARCHIVED' | 'DRAFT';
};

export async function updatePrepPack(params: {
  userId: string;
  packId: string;
  input: UpdatePrepPackInput;
}): Promise<PrepPackSummary | null> {
  const row = await prisma.interviewPrepPack.findFirst({ where: { id: params.packId, userId: params.userId } });
  if (!row) return null;

  const interviewAt = params.input.interviewAt !== undefined ? params.input.interviewAt : row.interviewAt;
  const timing =
    params.input.timing ??
    (params.input.interviewAt !== undefined
      ? resolveHorizon({ interviewAt, timing: row.timing as PrepTiming })
      : (row.timing as PrepTiming));

  const updated = (await prisma.interviewPrepPack.update({
    where: { id: params.packId },
    data: {
      ...(params.input.title !== undefined ? { title: tidy(params.input.title, 160) ?? row.title } : {}),
      ...(params.input.context !== undefined ? { context: params.input.context } : {}),
      ...(params.input.context !== undefined && params.input.interviewFormat === undefined
        ? { interviewFormat: params.input.context }
        : {}),
      ...(params.input.interviewFormat !== undefined ? { interviewFormat: params.input.interviewFormat } : {}),
      ...(params.input.interviewAt !== undefined ? { interviewAt } : {}),
      ...(params.input.timing !== undefined || params.input.interviewAt !== undefined ? { timing } : {}),
      ...(params.input.interviewerInfo !== undefined
        ? { interviewerInfo: tidyMultiline(params.input.interviewerInfo, 2_000) }
        : {}),
      ...(params.input.invitationNotes !== undefined
        ? { invitationNotes: tidyMultiline(params.input.invitationNotes, 2_000) }
        : {}),
      ...(params.input.concerns !== undefined
        ? { concerns: tidyMultiline(params.input.concerns, 1_200) }
        : {}),
      ...(params.input.focusTopics !== undefined
        ? {
            focusTopics: params.input.focusTopics
              .map((topic) => tidy(topic, 120))
              .filter((topic): topic is string => Boolean(topic))
              .slice(0, 8),
          }
        : {}),
      ...(params.input.interviewLanguage !== undefined
        ? { interviewLanguage: tidy(params.input.interviewLanguage, 80) }
        : {}),
      ...(params.input.companyWebsiteUrl !== undefined
        ? { companyWebsiteUrl: tidy(params.input.companyWebsiteUrl, 2_048) }
        : {}),
      ...(params.input.careersUrl !== undefined ? { careersUrl: tidy(params.input.careersUrl, 2_048) } : {}),
      ...(params.input.researchUrls !== undefined
        ? {
            researchUrls: params.input.researchUrls
              .map((url) => tidy(url, 2_048))
              .filter((url): url is string => Boolean(url))
              .slice(0, INTERVIEW_PREP_MAX_RESEARCH_URLS),
          }
        : {}),
      ...(params.input.jobUrl !== undefined ? { jobUrl: tidy(params.input.jobUrl, 2_048) } : {}),
      ...(params.input.jobDescription !== undefined
        ? { jobDescription: tidyMultiline(params.input.jobDescription, 60_000) }
        : {}),
      ...(params.input.company !== undefined ? { company: tidy(params.input.company, 160) ?? row.company } : {}),
      ...(params.input.roleTitle !== undefined ? { roleTitle: tidy(params.input.roleTitle, 200) ?? row.roleTitle } : {}),
      ...(params.input.location !== undefined ? { location: tidy(params.input.location, 200) } : {}),
      ...(params.input.status !== undefined ? { status: params.input.status } : {}),
      lastActivityAt: new Date(),
    },
  })) as PackRow;

  if (params.input.interviewAt !== undefined || params.input.timing !== undefined) {
    await recalculateTaskSchedule({ packId: params.packId, interviewAt, timing });
  }

  return toSummary(updated, false);
}

/**
 * Re-schedule existing tasks when the interview date moves. Completion state
 * is preserved; only the horizon and order change.
 */
export async function recalculateTaskSchedule(params: {
  packId: string;
  interviewAt: Date | null;
  timing: PrepTiming;
}): Promise<{ updated: number; timing: PrepTiming }> {
  const tasks = await prisma.interviewPrepTask.findMany({ where: { packId: params.packId } });
  if (tasks.length === 0) return { updated: 0, timing: params.timing };

  const horizon = resolveHorizon({ interviewAt: params.interviewAt, timing: params.timing });
  const imminent = horizon === 'WITHIN_24_HOURS' || horizon === 'TWO_THREE_DAYS';

  await prisma.$transaction(async (tx) => {
    for (const task of tasks) {
      const isLogistics = task.category === 'LOGISTICS';
      const isHigh = task.priority === 'HIGH';
      let next: PrepHorizon;
      if (imminent) {
        next = isHigh || isLogistics ? 'WITHIN_24_HOURS' : 'TWO_THREE_DAYS';
      } else if (horizon === 'WITHIN_A_WEEK') {
        next = isHigh ? 'TWO_THREE_DAYS' : 'WITHIN_A_WEEK';
      } else if (horizon === 'MORE_THAN_A_WEEK') {
        next = isHigh ? 'WITHIN_A_WEEK' : 'MORE_THAN_A_WEEK';
      } else {
        next = task.horizon as PrepHorizon;
      }
      await tx.interviewPrepTask.update({ where: { id: task.id }, data: { horizon: next } });
    }

    const reordered = await tx.interviewPrepTask.findMany({
      where: { packId: params.packId },
      orderBy: [{ horizon: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
    });
    for (let index = 0; index < reordered.length; index += 1) {
      await tx.interviewPrepTask.update({ where: { id: reordered[index].id }, data: { sortOrder: index } });
    }
  }, { timeout: 20_000 });

  return { updated: tasks.length, timing: horizon };
}

export async function updateTaskStatus(params: {
  userId: string;
  packId: string;
  taskId: string;
  status: TaskStatus;
}): Promise<PrepTask | null> {
  const pack = await prisma.interviewPrepPack.findFirst({
    where: { id: params.packId, userId: params.userId },
    select: { id: true },
  });
  if (!pack) return null;

  const task = await prisma.interviewPrepTask.findFirst({ where: { id: params.taskId, packId: params.packId } });
  if (!task) return null;

  const updated = await prisma.interviewPrepTask.update({
    where: { id: task.id },
    data: {
      status: params.status,
      completedAt: params.status === 'COMPLETED' ? new Date() : null,
    },
  });

  await prisma.interviewPrepPack.update({
    where: { id: params.packId },
    data: { lastActivityAt: new Date() },
  });

  return toTask(updated);
}

// ─── Practice ──────────────────────────────────────────────────────────────

/**
 * Which feedback rubric dimensions apply to each question category.
 *
 * Unrelated dimensions are never scored: a debugging answer is not marked
 * down for lacking a STAR structure, and a recruiter-screen answer is not
 * marked down for system-design trade-offs.
 */
export function rubricDimensionsForCategory(category: QuestionCategory): RubricDimension[] {
  const base: RubricDimension[] = ['RELEVANCE', 'CLARITY_STRUCTURE', 'COMMUNICATION', 'COMPLETENESS'];

  switch (category) {
    case 'BEHAVIORAL':
      return [...base, 'CONCRETE_EXAMPLE', 'ROLE_SKILLS', 'SUPPORTED_OUTCOMES'];
    case 'TECHNICAL_FUNDAMENTALS':
    case 'APPLIED_PROBLEM_SOLVING':
      return [...base, 'TECHNICAL_CORRECTNESS', 'REASONING_TRADE_OFFS'];
    case 'ARCHITECTURE_TRADE_OFFS':
      return [...base, 'REASONING_TRADE_OFFS', 'ROLE_SKILLS'];
    case 'DEBUGGING':
      return [...base, 'TECHNICAL_CORRECTNESS', 'REASONING_TRADE_OFFS'];
    case 'PROJECT_DECISIONS':
    case 'COLLABORATION':
    case 'OWNERSHIP':
      return [...base, 'CONCRETE_EXAMPLE', 'ROLE_SKILLS'];
    case 'HANDLING_AMBIGUITY':
      return [...base, 'REASONING_TRADE_OFFS', 'COMMUNICATION'];
    case 'ROLE_SCENARIO':
      return [...base, 'ROLE_SKILLS', 'PROFESSIONAL_JUDGMENT'];
    case 'MOTIVATION':
      return [...base, 'ROLE_SKILLS'];
    case 'EMPLOYER_QUESTIONS':
      return base;
    default:
      return base;
  }
}

export type QuestionForPractice = {
  id: string;
  version: number;
  ordinal: number;
  category: QuestionCategory;
  difficulty: Difficulty;
  competency: string;
  question: string;
  whyMatters: string;
  relatedRequirement: string | null;
  relevantExperience: string | null;
  prepNotes: string | null;
  answerStructure: AnswerStructure | null;
  sourceType: string;
  sourceEvidence: string | null;
  priority: Priority;
  evidenceBasis: string;
  strongAnswerShows: string | null;
  commonPitfalls: string[];
  coaching: unknown;
  sourceRefs: string[];
  followUpQuestionIds: string[];
  isPrediction: boolean;
  isActive: boolean;
};

export async function getQuestionForPractice(params: {
  userId: string;
  packId: string;
  questionId: string;
  /** When present, only attempts from this mock session are returned. */
  sessionId?: string | null;
}): Promise<{
  question: QuestionForPractice;
  attempt: PracticeAttemptView | null;
  attempts: PracticeAttemptView[];
} | null> {
  const pack = await prisma.interviewPrepPack.findFirst({
    where: { id: params.packId, userId: params.userId },
    select: { id: true },
  });
  if (!pack) return null;

  const question = await prisma.interviewQuestion.findFirst({
    where: {
      id: params.questionId,
      packId: params.packId,
      // Active-only for free practice. A mock session may still open a question
      // that regeneration has since deactivated, because its history is valid.
      ...(params.sessionId ? {} : { isActive: true }),
    },
  });
  if (!question) return null;

  if (params.sessionId) {
    const session = await prisma.interviewPracticeSession.findFirst({
      where: { id: params.sessionId, packId: params.packId, userId: params.userId },
      select: { questionIds: true },
    });
    if (!session || !asStringArray(session.questionIds).includes(params.questionId)) {
      throw new PrepSessionNotFoundError();
    }
  }

  const attempts = await prisma.interviewPracticeAttempt.findMany({
    where: {
      userId: params.userId,
      packId: params.packId,
      questionId: params.questionId,
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    },
    orderBy: { attemptNumber: 'desc' },
    take: 10,
  });

  return {
    question: {
      id: question.id,
      version: question.version,
      ordinal: question.ordinal,
      category: question.category as QuestionCategory,
      difficulty: question.difficulty as Difficulty,
      competency: question.competency,
      question: question.question,
      whyMatters: question.whyMatters ?? '',
      relatedRequirement: question.relatedRequirement,
      relevantExperience: question.relevantExperience,
      prepNotes: question.prepNotes,
      answerStructure: question.answerStructure as AnswerStructure | null,
      sourceType: question.sourceType,
      sourceEvidence: question.sourceEvidence,
      priority: question.priority as Priority,
      evidenceBasis: question.evidenceBasis,
      strongAnswerShows: question.strongAnswerShows,
      commonPitfalls: asStringArray(question.commonPitfalls),
      coaching: question.coaching,
      sourceRefs: asStringArray(question.sourceRefs),
      followUpQuestionIds: asStringArray(question.followUpQuestionIds),
      isPrediction: question.isPrediction,
      isActive: question.isActive,
    },
    attempt: attempts[0] ? toAttempt(attempts[0]) : null,
    attempts: attempts.map(toAttempt),
  };
}

/**
 * Save a practice answer. Drafts consume nothing; feedback is separate.
 */
export async function submitPracticeAnswer(params: {
  userId: string;
  packId: string;
  questionId: string;
  answer: string;
  sessionId?: string | null;
  kind?: 'INITIAL' | 'REVISION' | 'FOLLOW_UP';
  parentAttemptId?: string | null;
  followUpQuestion?: string | null;
}): Promise<PracticeAttemptView> {
  const { userId, packId, questionId } = params;

  const pack = await prisma.interviewPrepPack.findFirst({ where: { id: packId, userId }, select: { id: true } });
  if (!pack) throw new InterviewPrepPackNotFoundError();

  const question = await prisma.interviewQuestion.findFirst({
    where: {
      id: questionId,
      packId,
      // A mock session may contain a question that regeneration has since
      // deactivated. Its session membership is validated below.
      ...(params.sessionId ? {} : { isActive: true }),
    },
    select: { id: true, version: true },
  });
  if (!question) throw new InterviewPrepPackNotFoundError();

  const answer = params.answer.replace(/\r\n/g, '\n').trim();
  if (answer.length < 5) throw new PracticeAnswerTooShortError();
  if (answer.length > INTERVIEW_PREP_MAX_ANSWER_CHARS) {
    throw new PrepValidationError(`Keep your answer under ${INTERVIEW_PREP_MAX_ANSWER_CHARS.toLocaleString()} characters.`);
  }

  if (params.sessionId) {
    const session = await prisma.interviewPracticeSession.findFirst({
      where: { id: params.sessionId, packId, userId },
      select: { questionIds: true },
    });
    if (!session || !asStringArray(session.questionIds).includes(questionId)) {
      throw new PrepSessionNotFoundError();
    }
  }

  if (params.parentAttemptId) {
    const parent = await prisma.interviewPracticeAttempt.findFirst({
      where: { id: params.parentAttemptId, packId, userId },
      select: { id: true },
    });
    if (!parent) throw new PrepValidationError('That previous attempt could not be found.');
  }

  const previous = await prisma.interviewPracticeAttempt.findFirst({
    where: { userId, packId, questionId },
    orderBy: { attemptNumber: 'desc' },
    select: { attemptNumber: true },
  });

  const attempt = await prisma.interviewPracticeAttempt.create({
    data: {
      userId,
      packId,
      questionId,
      sessionId: params.sessionId ?? null,
      kind: params.kind ?? (previous ? 'REVISION' : 'INITIAL'),
      parentAttemptId: params.parentAttemptId ?? null,
      followUpQuestion: tidy(params.followUpQuestion, 500),
      questionVersion: question.version,
      answer,
      attemptNumber: (previous?.attemptNumber ?? 0) + 1,
    },
  });

  await updatePackProgress(packId);

  return toAttempt(attempt);
}

/**
 * Generate feedback for one submitted answer. Metered AI operation.
 */
export async function generatePracticeFeedback(params: {
  userId: string;
  packId: string;
  attemptId: string;
  route: string;
  provider?: InterviewPrepAiProvider;
}): Promise<{
  attempt: PracticeAttemptView;
  feedback: StoredFeedback;
  creditsConsumed: number;
}> {
  const { userId, packId, attemptId, route } = params;

  const attemptRow = await prisma.interviewPracticeAttempt.findFirst({
    where: { id: attemptId, userId, packId },
    include: {
      question: true,
      pack: {
        select: {
          id: true,
          jobId: true,
          company: true,
          roleTitle: true,
          jobDescription: true,
          context: true,
        },
      },
    },
  });
  if (!attemptRow) throw new InterviewPrepPackNotFoundError();

  // Idempotency before entitlement or metering: a scored evaluation is already
  // the answer. Re-reading it stays free, even after a plan lapses.
  const existingFeedback = toStoredFeedback(attemptRow.feedback);
  if (isScoredFeedback(existingFeedback)) {
    await logImportantInfo({
      event: 'interview_feedback_reused',
      userId,
      route,
      context: { attemptId, packId, questionId: attemptRow.questionId },
    });
    return {
      attempt: toAttempt(attemptRow),
      feedback: existingFeedback,
      creditsConsumed: 0,
    };
  }

  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, INTERVIEW_PREP_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'interview_entitlement_denied',
      userId,
      route,
      context: { feature: INTERVIEW_PREP_FEATURE, attemptId },
    });
    throw error;
  }

  const answer = attemptRow.answer;
  if (answer.length < INTERVIEW_PREP_MIN_ANSWER_CHARS) {
    throw new PracticeAnswerTooShortError();
  }

  // Resolve configuration before charging, so a fail-closed provider never
  // costs the candidate a credit.
  let provider: InterviewPrepAiProvider;
  try {
    provider = params.provider ?? resolveInterviewPrepAiProvider();
  } catch (error) {
    await logImportantError({
      event: 'interview_feedback_failed',
      userId,
      route,
      error,
      context: { attemptId, code: 'AI_NOT_CONFIGURED' },
    });
    throw error;
  }

  const questionCategory = attemptRow.question.category as QuestionCategory;
  const dimensions = rubricDimensionsForCategory(questionCategory);
  const framework = attemptRow.question.answerStructure as AnswerStructure | null;
  const packContext = attemptRow.pack.context as InterviewContext;
  const track = interviewTrackForContext(packContext);

  const coaching = (attemptRow.question.coaching ?? null) as {
    whatInterviewerAssesses?: string;
    keyPoints?: string[];
  } | null;
  const coachingContext = [
    coaching?.whatInterviewerAssesses
      ? `What the interviewer assesses: ${coaching.whatInterviewerAssesses}`
      : null,
    Array.isArray(coaching?.keyPoints) && coaching.keyPoints.length > 0
      ? `Key points a strong answer covers: ${coaching.keyPoints.join('; ')}`
      : null,
    attemptRow.question.strongAnswerShows
      ? `A strong answer shows: ${attemptRow.question.strongAnswerShows}`
      : null,
    asStringArray(attemptRow.question.commonPitfalls).length > 0
      ? `Common pitfalls: ${asStringArray(attemptRow.question.commonPitfalls).join('; ')}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    await logImportantInfo({
      event: 'interview_prep_admin_bypass',
      userId,
      route,
      context: { attemptId, operation: 'feedback' },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, INTERVIEW_PREP_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        // Legacy unscored feedback already consumed this key. Re-evaluating it
        // is therefore free, and a concurrent duplicate cannot double-charge.
        idempotencyKey: `interview-feedback:${attemptId}`,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'interview_usage_denied',
          userId,
          route,
          context: { feature: INTERVIEW_PREP_FEATURE, limit: error.limit, used: error.used, attemptId },
        });
      }
      throw error;
    }
  }

  const candidate = await buildCandidateContext({ userId, jobId: attemptRow.pack.jobId });

  let feedback: StoredFeedback;
  try {
    const modelFeedback = await provider.generateFeedback({
      question: attemptRow.question.question,
      category: questionCategory,
      difficulty: attemptRow.question.difficulty,
      competency: attemptRow.question.competency,
      whyMatters: attemptRow.question.whyMatters ?? '',
      answer,
      roleTitle: attemptRow.pack.roleTitle,
      company: attemptRow.pack.company,
      context: packContext,
      track,
      dimensions,
      framework,
      coachingContext,
      jobContext: (attemptRow.pack.jobDescription ?? '').slice(0, 4_000),
      candidateContext: candidate.profileText.slice(0, 4_000),
    });

    const verified = verifyFeedback({
      feedback: modelFeedback,
      answerText: answer,
      allowedDimensions: dimensions,
    });

    feedback = {
      score: verified.score,
      scoreRationale: verified.scoreRationale,
      modelAnswer: verified.modelAnswer,
      dimensions: verified.dimensions,
      whatWorked: verified.whatWorked,
      needsImprovement: verified.needsImprovement,
      missing: verified.missing,
      structureSuggestion: verified.structureSuggestion,
      revisedStructure: verified.revisedStructure,
      followUpPractice: verified.followUpPractice,
      adaptiveFollowUp: verified.adaptiveFollowUp,
      limitations: verified.limitations,
    };
  } catch (error) {
    await logImportantError({
      event: 'interview_feedback_failed',
      userId,
      route,
      error,
      context: { attemptId, code: error instanceof InterviewPrepAiError ? error.code : 'AI_UNAVAILABLE' },
    });
    throw error;
  }

  const updated = await prisma.interviewPracticeAttempt.update({
    where: { id: attemptId },
    data: {
      feedback: feedback as unknown as Prisma.InputJsonValue,
      rubricKey: dimensions.join(','),
    },
  });

  await updatePackProgress(packId);

  if (attemptRow.sessionId) {
    await refreshSessionSummary(attemptRow.sessionId);
  }

  await logImportantInfo({
    event: 'interview_feedback_generated',
    userId,
    route,
    context: {
      attemptId,
      packId,
      questionId: attemptRow.questionId,
      creditsConsumed,
      score: feedback.score,
      dimensions: dimensions.length,
      context: packContext,
      track,
    },
  });

  return { attempt: toAttempt(updated), feedback, creditsConsumed };
}

async function updatePackProgress(packId: string): Promise<void> {
  const [attemptedGroups, feedbackGroups, questionCount] = await Promise.all([
    prisma.interviewPracticeAttempt.groupBy({
      by: ['questionId'],
      where: { packId },
      _count: { id: true },
    }),
    prisma.interviewPracticeAttempt.groupBy({
      by: ['questionId'],
      where: { packId, feedback: { not: Prisma.DbNull } },
      _count: { id: true },
    }),
    prisma.interviewQuestion.count({ where: { packId, isActive: true } }),
  ]);

  await prisma.interviewPrepPack.update({
    where: { id: packId },
    data: {
      practicedCount: attemptedGroups.length,
      feedbackCount: feedbackGroups.length,
      lastPracticedAt: attemptedGroups.length > 0 ? new Date() : null,
      questionCount,
      lastActivityAt: new Date(),
    },
  });
}

// ─── Sessions ──────────────────────────────────────────────────────────────

export async function createPracticeSession(params: {
  userId: string;
  packId: string;
  mode?: PracticeMode;
}): Promise<PracticeSessionView> {
  const pack = await prisma.interviewPrepPack.findFirst({
    where: { id: params.packId, userId: params.userId },
    select: { id: true, status: true, context: true },
  });
  if (!pack) throw new InterviewPrepPackNotFoundError();
  if (pack.status === 'FAILED' || pack.status === 'DRAFT') {
    throw new PrepValidationError('Generate the preparation pack before starting a mock interview.');
  }

  const context = pack.context as InterviewContext;
  // The mock should start in the format the user is actually preparing for
  // unless they explicitly choose another focus.
  const mode = params.mode ?? defaultPracticeModeForContext(context);

  const questions = await prisma.interviewQuestion.findMany({
    where: { packId: params.packId, isActive: true },
    select: { id: true, category: true, priority: true, ordinal: true },
    orderBy: { ordinal: 'asc' },
  });
  if (questions.length === 0) {
    throw new PrepValidationError('There are no questions to practise yet.');
  }

  const attempts = await prisma.interviewPracticeAttempt.findMany({
    where: { packId: params.packId, userId: params.userId },
    select: { questionId: true },
  });
  const attemptedQuestionIds = new Set(attempts.map((attempt) => attempt.questionId));
  const questionIds = selectPracticeQuestionIds({
    mode,
    questions,
    attemptedQuestionIds,
    context,
  });

  // One active session per pack keeps the workspace coherent; a new run closes
  // the previous abandoned one rather than silently stacking sessions.
  await prisma.interviewPracticeSession.updateMany({
    where: { packId: params.packId, userId: params.userId, status: 'ACTIVE' },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  const session = await prisma.interviewPracticeSession.create({
    data: {
      userId: params.userId,
      packId: params.packId,
      mode,
      status: 'ACTIVE',
      questionIds,
    },
  });

  await prisma.interviewPrepPack.update({
    where: { id: params.packId },
    data: { lastActivityAt: new Date() },
  });

  return toSession(session);
}

export async function getPracticeSession(params: {
  userId: string;
  packId: string;
  sessionId: string;
}): Promise<{
  session: PracticeSessionView;
  attempts: PracticeAttemptView[];
  questions: QuestionForPractice[];
} | null> {
  const session = await prisma.interviewPracticeSession.findFirst({
    where: { id: params.sessionId, packId: params.packId, userId: params.userId },
  });
  if (!session) return null;

  const questionIds = asStringArray(session.questionIds);
  const [questionRows, attempts] = await Promise.all([
    prisma.interviewQuestion.findMany({
      where: { id: { in: questionIds }, packId: params.packId },
    }),
    prisma.interviewPracticeAttempt.findMany({
      where: { sessionId: session.id, userId: params.userId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Preserve the server-selected sequence stored on the session. A question
  // may since have been deactivated by regeneration; history still opens.
  const questionById = new Map(questionRows.map((question) => [question.id, question]));
  const questions = questionIds
    .map((id) => questionById.get(id))
    .filter((question): question is (typeof questionRows)[number] => Boolean(question));

  return {
    session: toSession(session),
    attempts: attempts.map(toAttempt),
    questions: questions.map((question) => ({
      id: question.id,
      version: question.version,
      ordinal: question.ordinal,
      category: question.category as QuestionCategory,
      difficulty: question.difficulty as Difficulty,
      competency: question.competency,
      question: question.question,
      whyMatters: question.whyMatters ?? '',
      relatedRequirement: question.relatedRequirement,
      relevantExperience: question.relevantExperience,
      prepNotes: question.prepNotes,
      answerStructure: question.answerStructure as AnswerStructure | null,
      sourceType: question.sourceType,
      sourceEvidence: question.sourceEvidence,
      priority: question.priority as Priority,
      evidenceBasis: question.evidenceBasis,
      strongAnswerShows: question.strongAnswerShows,
      commonPitfalls: asStringArray(question.commonPitfalls),
      coaching: question.coaching,
      sourceRefs: asStringArray(question.sourceRefs),
      followUpQuestionIds: asStringArray(question.followUpQuestionIds),
      isPrediction: question.isPrediction,
      isActive: question.isActive,
    })),
  };
}

export async function completePracticeSession(params: {
  userId: string;
  packId: string;
  sessionId: string;
}): Promise<PracticeSessionView | null> {
  const session = await prisma.interviewPracticeSession.findFirst({
    where: { id: params.sessionId, packId: params.packId, userId: params.userId },
  });
  if (!session) return null;

  const attempts = await prisma.interviewPracticeAttempt.findMany({
    where: { sessionId: session.id, userId: params.userId },
    select: { questionId: true, feedback: true, attemptNumber: true },
    orderBy: { attemptNumber: 'desc' },
  });

  const summary = summariseSession({
    attempts,
    questionCount: asStringArray(session.questionIds).length,
  });

  const updated = await prisma.interviewPracticeSession.update({
    where: { id: session.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      summary: summary as unknown as Prisma.InputJsonValue,
    },
  });

  await prisma.interviewPrepPack.update({
    where: { id: params.packId },
    data: { lastActivityAt: new Date() },
  });

  return toSession(updated);
}

async function refreshSessionSummary(sessionId: string): Promise<void> {
  const session = await prisma.interviewPracticeSession.findUnique({ where: { id: sessionId } });
  if (!session) return;
  const attempts = await prisma.interviewPracticeAttempt.findMany({
    where: { sessionId },
    select: { questionId: true, feedback: true, attemptNumber: true },
    orderBy: { attemptNumber: 'desc' },
  });
  const summary = summariseSession({
    attempts,
    questionCount: asStringArray(session.questionIds).length,
  });
  await prisma.interviewPracticeSession.update({
    where: { id: sessionId },
    data: { summary: summary as unknown as Prisma.InputJsonValue },
  });
}

// ─── Import and misc ───────────────────────────────────────────────────────

export async function importPrepJobUrl(rawUrl: string): Promise<Awaited<ReturnType<typeof importJobPosting>>> {
  return importJobPosting(rawUrl);
}

/** Refresh a pack by re-running generation against its current inputs. */
export async function refreshPackQuestions(params: {
  userId: string;
  packId: string;
  route: string;
  provider?: InterviewPrepAiProvider;
}): Promise<RunPrepGenerationResult> {
  return generatePrepPack({
    userId: params.userId,
    packId: params.packId,
    force: true,
    route: params.route,
    provider: params.provider,
  });
}
