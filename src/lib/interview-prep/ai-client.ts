/**
 * Server-side AI provider boundary for interview preparation.
 *
 * Mirrors `src/lib/job-intelligence/ai-client.ts`: one OpenAI integration,
 * schema-constrained structured outputs, no tools, and every provider detail
 * kept out of the browser.
 *
 * Two operations:
 *  - generatePack(params) -> ModelPack
 *  - generateFeedback(params) -> ModelFeedback
 */

import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { logImportantError } from '@/lib/observability';
import { AI_MODEL_DEFAULTS, getAiModel } from '@/lib/ai/model-registry';
import { sanitizeProviderText } from '@/lib/ai/text-safety';
import {
  INTERVIEW_PREP_ERROR_MESSAGES,
  INTERVIEW_PREP_SCHEMA_VERSION,
  modelFeedbackSchema,
  modelPackFoundationSchema,
  modelPackPlanSchema,
  modelPackQuestionsSchema,
  modelPackRoleSchema,
  type InterviewContext,
  type InterviewTrack,
  type ModelFeedback,
  type ModelPack,
} from './schema';
import { INTERVIEW_PREP_AI_TIMEOUT_MS } from './limits';
import { FEEDBACK_SYSTEM_PROMPT, INTERVIEW_PREP_SYSTEM_PROMPT, buildFeedbackPrompt, buildGenerationPrompt } from './prompt';

export const DEFAULT_INTERVIEW_PREP_MODEL = AI_MODEL_DEFAULTS.INTERVIEW_PREP;

export function getInterviewPrepModel(): string {
  return getAiModel('INTERVIEW_PREP');
}

/** Name recorded on each pack and feedback so results are traceable. */
export const AI_PROVIDER_NAME = 'openai';

/**
 * Provider detail kept for server logs only.
 *
 * A 400 from a structured-output call is almost never explained by the status
 * alone: the useful part is `code`, `param` and the provider's message. This
 * is deliberately never serialised into an API response.
 */
export type InterviewPrepProviderDetail = {
  status?: number;
  code?: string;
  type?: string;
  param?: string;
  message?: string;
  requestId?: string;
};

/** A failure the user can be told something useful about, and nothing more. */
export class InterviewPrepAiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  /** Provider-specific status, for logs. Never sent to the browser. */
  readonly providerStatus?: number;
  /** Original provider detail, for logs. Never sent to the browser. */
  readonly providerDetail?: InterviewPrepProviderDetail;

  constructor(
    code: string,
    retryable: boolean,
    providerStatus?: number,
    providerDetail?: InterviewPrepProviderDetail,
  ) {
    super(`Interview preparation failed: ${code}`);
    this.name = 'InterviewPrepAiError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
    this.providerDetail = providerDetail;
  }

  /** Safe, user-facing copy. No provider detail crosses this boundary. */
  get userMessage(): string {
    return (
      INTERVIEW_PREP_ERROR_MESSAGES[this.code as keyof typeof INTERVIEW_PREP_ERROR_MESSAGES] ??
      INTERVIEW_PREP_ERROR_MESSAGES.AI_UNAVAILABLE
    );
  }
}

export class InterviewPrepAiNotConfiguredError extends InterviewPrepAiError {
  constructor() {
    super('AI_NOT_CONFIGURED', false);
    this.name = 'InterviewPrepAiNotConfiguredError';
  }
}

export type GeneratePackParams = {
  packBlock: string;
  candidateBlock: string;
  sourceBlock: string;
  jobText: string;
  context: InterviewContext;
  track: InterviewTrack;
  horizon: string;
  maxQuestions: number;
  maxTasks: number;
  language: string | null;
};

export type GenerateFeedbackParams = {
  question: string;
  category: string;
  difficulty: string;
  competency: string;
  whyMatters: string;
  answer: string;
  roleTitle: string;
  company: string;
  context: InterviewContext;
  track: InterviewTrack;
  dimensions: string[];
  framework: string | null;
  /** What the interviewer assesses, key points and what a strong answer shows. */
  coachingContext: string;
  jobContext: string;
  candidateContext: string;
};

/** What the service layer needs from an AI provider. */
export type InterviewPrepAiProvider = {
  readonly name: string;
  readonly model: string;
  generatePack(params: GeneratePackParams): Promise<ModelPack>;
  generateFeedback(params: GenerateFeedbackParams): Promise<ModelFeedback>;
};

function stringFrom(record: unknown, key: string): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function providerDetailFrom(
  error: unknown,
  status?: number,
): InterviewPrepProviderDetail | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const record = error as Record<string, unknown>;
  const body =
    record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : undefined;

  const message = stringFrom(body, 'message') ?? stringFrom(record, 'message');
  const detail: InterviewPrepProviderDetail = {
    status,
    code: stringFrom(body, 'code') ?? stringFrom(record, 'code'),
    type: stringFrom(body, 'type'),
    param: stringFrom(body, 'param'),
    // Provider messages can include a request id or a fragment of the input.
    // Truncate before it reaches a log sink or an alert.
    message: message ? message.slice(0, 600) : undefined,
    requestId: stringFrom(record, 'request_id') ?? stringFrom(record, 'requestId'),
  };

  return Object.values(detail).some((value) => value !== undefined) ? detail : undefined;
}

function mapProviderError(error: unknown): InterviewPrepAiError {
  if (error instanceof InterviewPrepAiError) return error;

  const status = (() => {
    const candidate = error as { status?: unknown } | null;
    return typeof candidate?.status === 'number' ? candidate.status : undefined;
  })();
  const detail = providerDetailFrom(error, status);
  const fail = (code: string, retryable: boolean) =>
    new InterviewPrepAiError(code, retryable, status, detail);

  if (status === 429) return fail('AI_RATE_LIMITED', true);
  if (status === 401 || status === 403) return fail('AI_NOT_CONFIGURED', false);
  if (status === 400 || status === 422) return fail('AI_UNAVAILABLE', false);
  if (status !== undefined && status >= 500) return fail('AI_UNAVAILABLE', true);

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new InterviewPrepAiError('AI_TIMEOUT', true, status, detail);
  }
  if (name === 'APIConnectionError') return fail('AI_UNAVAILABLE', true);

  return fail('AI_UNAVAILABLE', true);
}

export function createOpenAiInterviewPrepProvider(options?: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): InterviewPrepAiProvider {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new InterviewPrepAiNotConfiguredError();
  }

  const model = options?.model ?? getInterviewPrepModel();
  const timeoutMs = options?.timeoutMs ?? INTERVIEW_PREP_AI_TIMEOUT_MS;

  return {
    name: AI_PROVIDER_NAME,
    model,

    async generatePack(params): Promise<ModelPack> {
      const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });

      /**
       * One structured-output call for one slice of the pack.
       *
       * All slices run concurrently, so wall-clock time is the slowest slice
       * rather than the sum. Each call keeps its own provider error context so
       * a failure names the exact stage that timed out or was rejected.
       */
      async function parseSection<T extends z.ZodTypeAny>(args: {
        section: 'FOUNDATION' | 'ROLE' | 'QUESTIONS' | 'PLAN';
        schema: T;
        schemaName: string;
      }): Promise<z.infer<T>> {
        try {
          const response = await client.responses.parse({
            model,
            input: [
              { role: 'system', content: INTERVIEW_PREP_SYSTEM_PROMPT },
              {
                role: 'user',
                content: sanitizeProviderText(
                  buildGenerationPrompt({
                    packBlock: params.packBlock,
                    candidateBlock: params.candidateBlock,
                    sourceBlock: params.sourceBlock,
                    jobText: params.jobText,
                    context: params.context,
                    track: params.track,
                    horizon: params.horizon,
                    maxQuestions: params.maxQuestions,
                    maxTasks: params.maxTasks,
                    language: params.language,
                    section: args.section,
                  }),
                ),
              },
            ],
            text: {
              format: zodTextFormat(args.schema, args.schemaName),
            },
          });

          if (response.output_parsed === null) {
            throw new InterviewPrepAiError('AI_REFUSED', false);
          }

          const parsed = args.schema.safeParse(response.output_parsed);
          if (!parsed.success) throw new InterviewPrepAiError('AI_INVALID_RESPONSE', true);

          return parsed.data as z.infer<T>;
        } catch (error) {
          const mapped = mapProviderError(error);
          if (mapped.code !== 'AI_REFUSED' && mapped.code !== 'AI_INVALID_RESPONSE') {
            await logImportantError({
              event: 'interview_prep_provider_failed',
              route: '/api/interview-prep',
              error,
              context: {
                model,
                provider: AI_PROVIDER_NAME,
                providerStatus: mapped.providerStatus,
                providerDetail: mapped.providerDetail,
                operation: 'generatePack',
                stage: args.section,
              },
            });
          } else {
            await logImportantError({
              event: 'interview_prep_invalid_output',
              route: '/api/interview-prep',
              context: {
                model,
                provider: AI_PROVIDER_NAME,
                code: mapped.code,
                operation: 'generatePack',
                stage: args.section,
              },
            });
          }
          throw mapped;
        }
      }

      const [foundation, role, questions, plan] = await Promise.all([
        parseSection({
          section: 'FOUNDATION',
          schema: modelPackFoundationSchema,
          schemaName: 'interview_preparation_foundation',
        }),
        parseSection({
          section: 'ROLE',
          schema: modelPackRoleSchema,
          schemaName: 'interview_preparation_role',
        }),
        parseSection({
          section: 'QUESTIONS',
          schema: modelPackQuestionsSchema,
          schemaName: 'interview_preparation_questions',
        }),
        parseSection({
          section: 'PLAN',
          schema: modelPackPlanSchema,
          schemaName: 'interview_preparation_plan',
        }),
      ]);

      return {
        ...foundation,
        ...role,
        ...questions,
        ...plan,
        schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
      };
    },

    async generateFeedback(params): Promise<ModelFeedback> {
      const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });

      try {
        const response = await client.responses.parse({
          model,
          input: [
            { role: 'system', content: FEEDBACK_SYSTEM_PROMPT },
            {
              role: 'user',
              content: sanitizeProviderText(
                buildFeedbackPrompt({
                  question: params.question,
                  category: params.category,
                  difficulty: params.difficulty,
                  competency: params.competency,
                  whyMatters: params.whyMatters,
                  answer: params.answer,
                  roleTitle: params.roleTitle,
                  company: params.company,
                  context: params.context,
                  track: params.track,
                  dimensions: params.dimensions,
                  framework: params.framework,
                  coachingContext: params.coachingContext,
                  jobContext: params.jobContext,
                  candidateContext: params.candidateContext,
                }),
              ),
            },
          ],
          text: {
            format: zodTextFormat(modelFeedbackSchema, 'interview_preparation_feedback'),
          },
        });

        if (response.output_parsed === null) throw new InterviewPrepAiError('AI_REFUSED', false);

        const parsed = modelFeedbackSchema.safeParse(response.output_parsed);
        if (!parsed.success) throw new InterviewPrepAiError('AI_INVALID_RESPONSE', true);

        return parsed.data;
      } catch (error) {
        const mapped = mapProviderError(error);
        if (mapped.code !== 'AI_REFUSED' && mapped.code !== 'AI_INVALID_RESPONSE') {
          await logImportantError({
            event: 'interview_prep_provider_failed',
            route: '/api/interview-prep',
            error,
            context: {
              model,
              provider: AI_PROVIDER_NAME,
              providerStatus: mapped.providerStatus,
              providerDetail: mapped.providerDetail,
              operation: 'generateFeedback',
            },
          });
        } else {
          await logImportantError({
            event: 'interview_prep_invalid_output',
            route: '/api/interview-prep',
            context: { model, provider: AI_PROVIDER_NAME, code: mapped.code, operation: 'generateFeedback' },
          });
        }
        throw mapped;
      }
    },
  };
}

/**
 * Resolve the provider for a request.
 *
 * A seam so tests can substitute a fake without a key and without a network
 * call, and so the service layer never imports the SDK directly.
 */
export type InterviewPrepAiProviderFactory = () => InterviewPrepAiProvider;

let providerFactory: InterviewPrepAiProviderFactory | null = null;

/** Test-only override. Pass null to restore the real provider. */
export function __setInterviewPrepAiProviderFactory(factory: InterviewPrepAiProviderFactory | null): void {
  providerFactory = factory;
}

export function resolveInterviewPrepAiProvider(): InterviewPrepAiProvider {
  return providerFactory ? providerFactory() : createOpenAiInterviewPrepProvider();
}
