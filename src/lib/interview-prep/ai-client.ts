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
import { logImportantError } from '@/lib/observability';
import {
  INTERVIEW_PREP_ERROR_MESSAGES,
  INTERVIEW_PREP_SCHEMA_NAME,
  INTERVIEW_PREP_SCHEMA_VERSION,
  modelFeedbackSchema,
  modelPackSchema,
  type ModelFeedback,
  type ModelPack,
} from './schema';
import { INTERVIEW_PREP_AI_TIMEOUT_MS } from './limits';
import { FEEDBACK_SYSTEM_PROMPT, INTERVIEW_PREP_SYSTEM_PROMPT, buildFeedbackPrompt, buildGenerationPrompt } from './prompt';

export const DEFAULT_INTERVIEW_PREP_MODEL = 'gpt-4.1-mini';

export function getInterviewPrepModel(): string {
  return process.env.INTERVIEW_PREP_MODEL?.trim() || DEFAULT_INTERVIEW_PREP_MODEL;
}

/** Name recorded on each pack and feedback so results are traceable. */
export const AI_PROVIDER_NAME = 'openai';

/** A failure the user can be told something useful about, and nothing more. */
export class InterviewPrepAiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  /** Provider-specific status, for logs. Never sent to the browser. */
  readonly providerStatus?: number;

  constructor(code: string, retryable: boolean, providerStatus?: number) {
    super(`Interview preparation failed: ${code}`);
    this.name = 'InterviewPrepAiError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
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
  context: string;
  horizon: string;
  maxQuestions: number;
  maxTasks: number;
  language: string | null;
};

export type GenerateFeedbackParams = {
  question: string;
  category: string;
  answer: string;
  roleTitle: string;
  company: string;
  dimensions: string[];
  framework: string | null;
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

function mapProviderError(error: unknown): InterviewPrepAiError {
  if (error instanceof InterviewPrepAiError) return error;

  const status = (() => {
    const candidate = error as { status?: unknown } | null;
    return typeof candidate?.status === 'number' ? candidate.status : undefined;
  })();

  if (status === 429) return new InterviewPrepAiError('AI_RATE_LIMITED', true, status);
  if (status === 401 || status === 403) return new InterviewPrepAiError('AI_NOT_CONFIGURED', false, status);
  if (status === 400 || status === 422) return new InterviewPrepAiError('AI_UNAVAILABLE', false, status);
  if (status !== undefined && status >= 500) return new InterviewPrepAiError('AI_UNAVAILABLE', true, status);

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new InterviewPrepAiError('AI_TIMEOUT', true);
  }
  if (name === 'APIConnectionError') return new InterviewPrepAiError('AI_UNAVAILABLE', true);

  return new InterviewPrepAiError('AI_UNAVAILABLE', true);
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

      try {
        const response = await client.responses.parse({
          model,
          input: [
            { role: 'system', content: INTERVIEW_PREP_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildGenerationPrompt({
                packBlock: params.packBlock,
                candidateBlock: params.candidateBlock,
                sourceBlock: params.sourceBlock,
                jobText: params.jobText,
                context: params.context,
                horizon: params.horizon,
                maxQuestions: params.maxQuestions,
                maxTasks: params.maxTasks,
                language: params.language,
              }),
            },
          ],
          text: {
            format: zodTextFormat(modelPackSchema, INTERVIEW_PREP_SCHEMA_NAME),
          },
        });

        if (response.output_parsed === null) throw new InterviewPrepAiError('AI_REFUSED', false);

        const parsed = modelPackSchema.safeParse(response.output_parsed);
        if (!parsed.success) throw new InterviewPrepAiError('AI_INVALID_RESPONSE', true);

        return { ...parsed.data, schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION };
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
              operation: 'generatePack',
            },
          });
        } else {
          await logImportantError({
            event: 'interview_prep_invalid_output',
            route: '/api/interview-prep',
            context: { model, provider: AI_PROVIDER_NAME, code: mapped.code, operation: 'generatePack' },
          });
        }
        throw mapped;
      }
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
              content: buildFeedbackPrompt({
                question: params.question,
                category: params.category,
                answer: params.answer,
                roleTitle: params.roleTitle,
                company: params.company,
                dimensions: params.dimensions,
                framework: params.framework,
                jobContext: params.jobContext,
                candidateContext: params.candidateContext,
              }),
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
