/**
 * Application-material orchestration.
 *
 * This is the only module allowed to start a paid AI operation for materials.
 * It runs the same checks in the same order for every request, and every one of
 * them happens BEFORE we spend money:
 *
 *   1. authenticate            (the caller passes a session-derived userId)
 *   2. check the entitlement   (subscriptions.ts, timestamp-derived)
 *   3. load the job, profile and selected resume (ownership-scoped)
 *   4. build context and compute the input fingerprint
 *   5. duplicate suppression   (reuse an existing completed row when the inputs
 *      match exactly; never charge twice for the same draft)
 *   6. claim the row           (the unique index on (userId, type, fingerprint,
 *      version) is the lock that stops two identical requests racing)
 *   7. check usage and rate limits
 *   8. run the generation      (no database lock is held while we wait)
 *   9. verify the output       (excerpts re-quoted, claims bounded, facts
 *      re-checked — nothing model-written is trusted)
 *  10. record the outcome      (status, model, credits, error)
 *
 * No external call ever happens inside a database transaction.
 */

import { prisma } from '@/lib/prisma';
import { getUserPreferences } from '@/lib/db-helpers';
import { hasPrismaUniqueViolation } from '@/lib/db-helpers';
import { PlanRequiredError, requireEntitlement, type Entitlement } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError, consumeUsage } from '@/lib/billing/usage';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { resolveApplicationMaterialAiProvider } from './ai-client';
import {
  ApplicationMaterialAiError,
  type ApplicationMaterialAiProvider,
} from './ai-client';
import {
  buildMaterialContext,
  type MaterialContext,
} from './context';
import { resolveLength, resolveTone, type MaterialLength, type Tone } from './materials';
import {
  MATERIAL_ERROR_MESSAGES,
  MATERIAL_SCHEMA_VERSION,
  MATERIAL_PROMPT_VERSION,
  modelMaterialSchema,
  type MaterialErrorCode,
  type MaterialResult,
  type ModelMaterial,
} from './schema';
import { verifyMaterial } from './verify';
import { MATERIAL_PROCESSING_STALE_MS } from './limits';
import {
  buildMaterialPrompt,
  MATERIAL_SYSTEM_PROMPT,
  type PromptInputs,
} from './prompt';

/** Feature key and metered capability — `AI_COVER_LETTER`, already defined. */
export const APPLICATION_MATERIAL_FEATURE: 'AI_COVER_LETTER' = 'AI_COVER_LETTER';

export class JobNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Job not found.');
    this.name = 'JobNotFoundError';
  }
}

export class DuplicateGenerationInFlightError extends Error {
  readonly code = 'DUPLICATE_REQUEST';
  readonly status = 409;

  constructor() {
    super('A draft for this material is already being generated.');
    this.name = 'DuplicateGenerationInFlightError';
  }
}

export type GenerationSummary = {
  id: string;
  jobId: string | null;
  type: string;
  status: string;
  generationStatus: string;
  schemaVersion: number;
  errorCode: MaterialErrorCode | null;
  createdAt: Date;
  completedAt: Date | null;
  model: string | null;
};

export type RunGenerationResult =
  | { outcome: 'REUSED'; summary: GenerationSummary; material: MaterialResult }
  | {
      outcome: 'COMPLETED';
      summary: GenerationSummary;
      material: MaterialResult;
      creditsConsumed: number;
    }
  | {
      outcome: 'FAILED';
      summary: GenerationSummary | null;
      code: MaterialErrorCode;
      message: string;
      retryable: boolean;
    };

export type RunGenerationOptions = {
  /** Server-derived. Never read from a request body. */
  userId: string;
  /** Material type being generated. */
  type: string;
  /** The job this material is for, when there is one. */
  jobId: string | null;
  /** The resume the user explicitly selected, when there is one. */
  resumeId: string | null;
  /** User-visible title for the saved material. */
  title: string;
  /** How this row came into existence. */
  origin: 'AI_GENERATED' | 'AI_REVISED' | 'TEMPLATE_DERIVED' | 'MANUAL';
  /** The material this one replaces, when this is a revision. */
  supersedesId: string | null;
  /** Re-run even when a completed draft exists for these exact inputs. */
  force?: boolean;
  route: string;
  /** Injected by tests; production always resolves the configured provider. */
  provider?: ApplicationMaterialAiProvider;
  /** Tone the user chose, resolved against what is allowed for this type. */
  tone: string;
  /** Length the user chose, resolved against what is allowed for this type. */
  length: string;
  /** Free-text style guidance from the user. Never adds facts. */
  instructions: string | null;
  /** A pasted conversation the user supplied as context. */
  conversation: string | null;
  /** A named recipient, only when meaningful for this type. */
  recipientName: string | null;
  /** The current draft text, when this is a revision. */
  sourceDraft: string | null;
};

type MaterialRow = {
  id: string;
  userId: string;
  type: string;
  jobId: string | null;
  title: string;
  content: string;
  origin: string;
  status: string;
  generationStatus: string;
  inputFingerprint: string;
  schemaVersion: number;
  promptVersion: number;
  generationMeta: unknown;
  errorCode: string | null;
  model: string | null;
  provider: string | null;
  creditsConsumed: number;
  revision: number;
  supersedesId: string | null;
  editVersion: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
};

function toSummary(row: MaterialRow): GenerationSummary {
  return {
    id: row.id,
    jobId: row.jobId,
    type: row.type,
    status: row.status,
    generationStatus: row.generationStatus,
    schemaVersion: row.schemaVersion,
    errorCode: (row.errorCode as MaterialErrorCode | null) ?? null,
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? null,
    model: row.model,
  };
}

function isStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > MATERIAL_PROCESSING_STALE_MS;
}

function findMaterialRow(params: {
  userId: string;
  type: string;
  inputFingerprint: string;
}): Promise<MaterialRow | null> {
  return prisma.applicationMaterial.findUnique({
    where: {
      userId_type_inputFingerprint_schemaVersion: {
        userId: params.userId,
        type: params.type as any,
        inputFingerprint: params.inputFingerprint,
        schemaVersion: MATERIAL_SCHEMA_VERSION,
      },
    },
  }) as Promise<MaterialRow | null>;
}

/**
 * Claim the material row for this exact input set.
 *
 * The unique index is the lock. A second request either loses the insert race
 * — and then re-reads and sees a run already in progress — or takes over a row
 * that has been stale long enough that its function must have died.
 */
async function claimMaterialRow(params: {
  userId: string;
  type: string;
  jobId: string | null;
  title: string;
  origin: 'AI_GENERATED' | 'AI_REVISED' | 'TEMPLATE_DERIVED' | 'MANUAL';
  supersedesId: string | null;
  inputFingerprint: string;
}): Promise<{ row: MaterialRow; claimed: boolean }> {
  const existing = await findMaterialRow({
    userId: params.userId,
    type: params.type,
    inputFingerprint: params.inputFingerprint,
  });

  if (!existing) {
    try {
      const created = await prisma.applicationMaterial.create({
        data: {
          userId: params.userId,
          type: params.type as any,
          jobId: params.jobId,
          title: params.title,
          content: '',
          origin: params.origin as any,
          supersedesId: params.supersedesId,
          inputFingerprint: params.inputFingerprint,
          schemaVersion: MATERIAL_SCHEMA_VERSION,
          promptVersion: MATERIAL_PROMPT_VERSION,
          generationStatus: 'PROCESSING',
        },
      });
      return { row: created as unknown as MaterialRow, claimed: true };
    } catch (error) {
      if (!hasPrismaUniqueViolation(error)) throw error;
      const raced = await findMaterialRow({
        userId: params.userId,
        type: params.type,
        inputFingerprint: params.inputFingerprint,
      });
      if (!raced) throw error;
      return { row: raced, claimed: false };
    }
  }

  if (existing.generationStatus === 'PROCESSING' && !isStale(existing.updatedAt)) {
    return { row: existing, claimed: false };
  }

  const updated = await prisma.applicationMaterial.update({
    where: { id: existing.id },
    data: { generationStatus: 'PROCESSING', errorCode: null },
  });
  return { row: updated as unknown as MaterialRow, claimed: true };
}

/**
 * Run a generation for one material context.
 *
 * Expected to throw `PlanRequiredError` (403) or `UsageLimitExceededError`
 * (403) before touching a provider. `ApplicationMaterialAiError` is captured
 * into the result instead, so a provider outage is a recoverable state the UI
 * can offer a retry for rather than a 500.
 */
export async function runGeneration(
  options: RunGenerationOptions,
): Promise<RunGenerationResult> {
  const { userId, route } = options;

  // 1. Entitlement.
  let entitlements: Entitlement;
  try {
    entitlements = await requireEntitlement(userId, APPLICATION_MATERIAL_FEATURE);
  } catch (error) {
    await logImportantInfo({
      event: 'application_material_entitlement_denied',
      userId,
      route,
      context: { feature: APPLICATION_MATERIAL_FEATURE },
    });
    throw error;
  }

  const profileVersion = await resolveProfileVersion(userId);

  // 2. Context: job, profile, selected resume.
  const context = await buildMaterialContext({
    userId,
    type: options.type as any,
    jobId: options.jobId ?? null,
    resumeId: options.resumeId ?? null,
    profileVersion,
  });

  // A job id that does not resolve to one of the caller's own jobs is a 404,
  // identical to a job that does not exist. Never confirm another user's job.
  if (options.jobId && !context.job) {
    throw new JobNotFoundError();
  }

  // 3. Build the input fingerprint over the real context the model will see,
  //    so two identical requests never diverge.
  const fingerprintInput = {
    type: context.type,
    candidateVersion: context.candidate.careerProfileVersion,
    job: context.job
      ? {
          id: context.job.id,
          company: context.job.company,
          title: context.job.title,
          description: context.job.description,
          updatedAt: context.job.updatedAt.toISOString(),
        }
      : null,
    application: context.application,
    resume: context.resume ? { id: context.resume.id, name: context.resume.name } : null,
    intelligence: context.intelligence ? { category: context.intelligence.category } : null,
    tone: 'PROFESSIONAL',
    length: 'STANDARD',
    instructions: '',
  };
  const inputFingerprint = await hashInputs(fingerprintInput);

  // 4. Reuse check BEFORE claiming — claiming flips the row to PROCESSING.
  if (!options.force) {
    const reusable = await findMaterialRow({
      userId,
      type: context.type,
      inputFingerprint,
    });
    if (reusable?.generationStatus === 'COMPLETED' && reusable.generationMeta) {
      await logImportantInfo({
        event: 'application_material_reused',
        userId,
        jobId: context.job?.id ?? undefined,
        route,
        context: { materialId: reusable.id, type: context.type },
      });
      const material = await materialFromRow(reusable);
      return { outcome: 'REUSED', summary: toSummary(reusable), material };
    }
  }

  const { row, claimed } = await claimMaterialRow({
    userId,
    type: context.type,
    jobId: context.job ? context.job.id : null,
    title: options.title,
    origin: options.origin,
    supersedesId: options.supersedesId,
    inputFingerprint,
  });

  // Another request for this exact input set is mid-flight.
  if (!claimed && row.generationStatus === 'PROCESSING') {
    throw new DuplicateGenerationInFlightError();
  }

  // 5. Usage — reserved immediately before the provider call, under the advisory
  //    lock, so parallel requests serialise and a retry of this same input set
  //    is not charged twice.
  const idempotencyKey = options.force ? `material:${row.id}:forced` : `material:${row.id}`;

  let creditsConsumed = 0;
  if (entitlements.isAdmin) {
    await logImportantInfo({
      event: 'application_material_admin_bypass',
      userId,
      jobId: context.job?.id ?? undefined,
      route,
      context: { materialId: row.id },
    });
  } else {
    try {
      const usage = await consumeUsage(userId, APPLICATION_MATERIAL_FEATURE, 1, {
        limit: entitlements.limits.aiCredits,
        idempotencyKey,
      });
      creditsConsumed = usage.consumed;
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        await logImportantInfo({
          event: 'application_material_usage_denied',
          userId,
          jobId: context.job?.id ?? undefined,
          route,
          context: { feature: APPLICATION_MATERIAL_FEATURE, limit: error.limit, used: error.used },
        });
        await releaseClaim(row.id);
      }
      throw error;
    }
  }

  // 6. Provider call. No transaction open, no row lock held.
  let provider: ApplicationMaterialAiProvider;
  try {
    provider = options.provider ?? resolveApplicationMaterialAiProvider();
  } catch (error) {
    await markFailed(row.id, error);
    return failureFor(row.id, error);
  }

  let model: ModelMaterial;
  try {
    const promptInputs = buildPromptInputs(context, {
      tone: resolveTone(context.type, options.tone),
      length: resolveLength(context.type, options.length),
      instructions: options.instructions ?? null,
      conversation: options.conversation ?? null,
      recipientName: options.recipientName ?? null,
      sourceDraft: options.sourceDraft ?? null,
    });
    const response = await provider.write({
      systemPrompt: MATERIAL_SYSTEM_PROMPT,
      userPrompt: buildMaterialPrompt(promptInputs),
    });
    const parsed = modelMaterialSchema.safeParse(response);
    if (!parsed.success) {
      throw new ApplicationMaterialAiError('AI_INVALID_RESPONSE', true);
    }
    model = parsed.data;
  } catch (error) {
    await markFailed(row.id, error);
    await logImportantError({
      event: 'application_material_generation_failed',
      userId,
      jobId: context.job?.id ?? undefined,
      route,
      error,
      context: { materialId: row.id, code: materialErrorCode(error) },
    });
    return failureFor(row.id, error);
  }

  // 7. Verify. Nothing model-written reaches the database until this pass.
  const sources = buildEvidenceSources(context);
  const verified = verifyMaterial({
    model,
    candidate: context.candidate,
    sources,
    meta: buildMeta(context),
  });

  // 8. Persist.
  const completed = await prisma.applicationMaterial.update({
    where: { id: row.id },
    data: {
      generationStatus: 'COMPLETED',
      generationMeta: verified,
      errorCode: null,
      provider: provider.name,
      model: provider.model,
      creditsConsumed,
      thinInputs:
        Boolean(
          context.candidate.profileText.length < 100 ||
            (context.job !== null && !context.job.hasDescription),
        ),
      ...(options.supersedesId ? { revision: { increment: 1 } } : {}),
    },
  });

  await logImportantInfo({
    event: 'application_material_generation_succeeded',
    userId,
    jobId: context.job?.id ?? undefined,
    route,
    context: {
      materialId: completed.id,
      type: context.type,
      model: provider.model,
      paragraphCount: verified.paragraphs.length,
      claimCount: verified.claims.length,
      warningCount: verified.warnings.length,
      creditsConsumed,
    },
  });

  const material = await materialFromRow(completed);
  return { outcome: 'COMPLETED', summary: toSummary(completed), material, creditsConsumed };
}

async function materialFromRow(row: MaterialRow): Promise<MaterialResult> {
  const data = row.generationMeta as MaterialResult | null;
  if (!data) throw new Error('Completed material has no stored data.');
  return data;
}

function buildPromptInputs(
  context: MaterialContext,
  userChoices: {
    tone: Tone;
    length: MaterialLength;
    instructions: string | null;
    conversation: string | null;
    recipientName: string | null;
    sourceDraft: string | null;
  },
): PromptInputs {
  return {
    type: context.type as any,
    tone: userChoices.tone,
    length: userChoices.length,
    candidateFacts: context.candidate.profileText,
    jobBlock: context.job ? buildJobBlock(context.job) : null,
    applicationBlock: buildApplicationBlock(context.application),
    resumeBlock: context.resume ? context.resume.text : null,
    intelligenceBlock: context.intelligence ? buildIntelligenceBlock(context.intelligence) : null,
    instructionsBlock: userChoices.instructions,
    conversationBlock: userChoices.conversation,
    templateBlock: null,
    sourceDraftBlock: userChoices.sourceDraft,
    recipientName: userChoices.recipientName,
    missingInputs: context.missingInputs,
    thinJob: Boolean(context.job && !context.job.hasDescription),
  };
}

function buildJobBlock(job: NonNullable<MaterialContext['job']>): string {
  const lines: string[] = [];
  lines.push(`Role: ${job.title}`);
  lines.push(`Company: ${job.company}`);
  if (job.location) lines.push(`Location: ${job.location}`);
  if (job.remoteType) lines.push(`Work arrangement: ${job.remoteType}`);
  if (job.description) lines.push(`Job description:\n${job.description}`);
  return lines.join('\n');
}

function buildApplicationBlock(application: MaterialContext['application']): string {
  const parts: string[] = [];
  if (application.hasApplied) parts.push('Application status: submitted.');
  if (application.stage === 'INTERVIEW_RECORDED' && application.latestInterview) {
    parts.push(
      `Latest interview: ${application.latestInterview.stage}, scheduled ${application.latestInterview.scheduledAt}.`,
    );
  }
  return parts.length ? parts.join(' ') : 'No application record stored for this role.';
}

function buildIntelligenceBlock(
  intelligence: NonNullable<MaterialContext['intelligence']>,
): string {
  return `Saved job analysis category: ${intelligence.category}. Summary: ${intelligence.summary}.`;
}

function buildEvidenceSources(context: MaterialContext): Record<string, string> {
  const sources: Record<string, string> = {};
  if (context.job?.description) sources.JOB_DESCRIPTION = context.job.description;
  if (context.job?.location) sources.JOB_METADATA = `${context.job.location} ${context.job.remoteType}`.trim();
  if (context.candidate.profileText) sources.CAREER_PROFILE = context.candidate.profileText;
  if (context.resume?.text) sources.RESUME = context.resume.text;
  const app = buildApplicationBlock(context.application);
  if (app) sources.APPLICATION_RECORD = app;
  return sources;
}

function buildMeta(context: MaterialContext) {
  return {
    schemaVersion: MATERIAL_SCHEMA_VERSION,
    promptVersion: MATERIAL_PROMPT_VERSION,
    inputFingerprint: '',
    generatedAt: new Date().toISOString(),
    provider: 'openai',
    model: 'unknown',
    tone: 'PROFESSIONAL',
    length: 'STANDARD',
    hadJobDescription: Boolean(context.job?.hasDescription),
    hadConfirmedCareerProfile: context.candidate.confirmed,
    hadSelectedResume: Boolean(context.resume),
    hadTemplate: false,
    applicationContext: context.application.stage as
      | 'NONE'
      | 'SUBMITTED'
      | 'INTERVIEW_SCHEDULED'
      | 'INTERVIEW_RECORDED',
    thinInputs: false,
  };
}

async function resolveProfileVersion(userId: string): Promise<number> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { careerProfileVersion: true },
  });
  return profile?.careerProfileVersion ?? 0;
}

async function hashInputs(inputs: unknown): Promise<string> {
  const text = JSON.stringify(inputs);
  const buffer = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function releaseClaim(materialId: string): Promise<void> {
  await prisma.applicationMaterial
    .update({
      where: { id: materialId },
      data: { generationStatus: 'FAILED', errorCode: 'AI_UNAVAILABLE' },
    })
    .catch(() => undefined);
}

async function markFailed(materialId: string, error: unknown): Promise<void> {
  await prisma.applicationMaterial
    .update({
      where: { id: materialId },
      data: { generationStatus: 'FAILED', errorCode: materialErrorCode(error) },
    })
    .catch(() => undefined);
}

function materialErrorCode(error: unknown): MaterialErrorCode {
  if (error instanceof ApplicationMaterialAiError) return error.code;
  return 'AI_UNAVAILABLE';
}

async function failureFor(materialId: string, error: unknown): Promise<RunGenerationResult> {
  const code = materialErrorCode(error);
  const row = await prisma.applicationMaterial.findUnique({ where: { id: materialId } }).catch(() => null);

  return {
    outcome: 'FAILED',
    summary: row ? toSummary(row as MaterialRow) : null,
    code,
    message: MATERIAL_ERROR_MESSAGES[code as MaterialErrorCode],
    retryable: error instanceof ApplicationMaterialAiError ? error.retryable : true,
  };
}

export { PlanRequiredError, ApplicationMaterialAiError };
