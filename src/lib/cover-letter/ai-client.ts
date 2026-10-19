/**
 * Server-side AI provider boundary for cover letters.
 *
 * Mirrors `src/lib/job-intelligence/ai-client.ts`: one OpenAI integration,
 * schema-constrained structured outputs, no tools, and every provider detail
 * kept out of the browser. A separate module from job intelligence because the
 * contract is different (a persuasive letter is not a fit analysis).
 *
 * One operation: generateCoverLetter(params) -> ModelCoverLetter.
 */

import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { logImportantError } from '@/lib/observability';
import {
  COVER_LETTER_ERROR_MESSAGES,
  COVER_LETTER_SCHEMA_NAME,
  COVER_LETTER_SCHEMA_VERSION,
  modelCoverLetterSchema,
  type ModelCoverLetter,
} from './schema';
import { COVER_LETTER_AI_TIMEOUT_MS } from './limits';
import {
  COVER_LETTER_SYSTEM_PROMPT,
  buildGenerationPrompt,
} from './prompt';

export const DEFAULT_COVER_LETTER_MODEL = 'gpt-4.1-mini';

export function getCoverLetterModel(): string {
  return process.env.COVER_LETTER_MODEL?.trim() || DEFAULT_COVER_LETTER_MODEL;
}

/** Name recorded on each letter so results are traceable to their model. */
export const AI_PROVIDER_NAME = 'openai';

/** A failure the user can be told something useful about, and nothing more. */
export class CoverLetterAiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  /** Provider-specific status, for logs. Never sent to the browser. */
  readonly providerStatus?: number;

  constructor(code: string, retryable: boolean, providerStatus?: number) {
    super(`Cover letter generation failed: ${code}`);
    this.name = 'CoverLetterAiError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }

  /** Safe, user-facing copy. No provider detail crosses this boundary. */
  get userMessage(): string {
    return COVER_LETTER_ERROR_MESSAGES[this.code as keyof typeof COVER_LETTER_ERROR_MESSAGES] ?? COVER_LETTER_ERROR_MESSAGES.AI_UNAVAILABLE;
  }
}

export class CoverLetterAiNotConfiguredError extends CoverLetterAiError {
  constructor() {
    super('AI_NOT_CONFIGURED', false);
    this.name = 'CoverLetterAiNotConfiguredError';
  }
}

/** What the service layer needs from an AI provider. */
export type CoverLetterAiProvider = {
  readonly name: string;
  readonly model: string;
  generateCoverLetter(params: {
    deterministicBlock: string;
    careerProfileBlock: string;
    jobText: string;
  }): Promise<ModelCoverLetter>;
};

function mapProviderError(error: unknown): CoverLetterAiError {
  if (error instanceof CoverLetterAiError) return error;

  const status = (() => {
    const candidate = error as { status?: unknown } | null;
    return typeof candidate?.status === 'number' ? candidate.status : undefined;
  })();

  if (status === 429) return new CoverLetterAiError('AI_RATE_LIMITED', true, status);
  if (status === 401 || status === 403) {
    return new CoverLetterAiError('AI_NOT_CONFIGURED', false, status);
  }
  if (status === 400 || status === 422) {
    return new CoverLetterAiError('AI_UNAVAILABLE', false, status);
  }
  if (status !== undefined && status >= 500) {
    return new CoverLetterAiError('AI_UNAVAILABLE', true, status);
  }

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new CoverLetterAiError('AI_TIMEOUT', true);
  }
  if (name === 'APIConnectionError') return new CoverLetterAiError('AI_UNAVAILABLE', true);

  return new CoverLetterAiError('AI_UNAVAILABLE', true);
}

export function createOpenAiCoverLetterProvider(options?: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): CoverLetterAiProvider {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new CoverLetterAiNotConfiguredError();
  }

  const model = options?.model ?? getCoverLetterModel();
  const timeoutMs = options?.timeoutMs ?? COVER_LETTER_AI_TIMEOUT_MS;

  return {
    name: AI_PROVIDER_NAME,
    model,

    async generateCoverLetter(params): Promise<ModelCoverLetter> {
      const client = new OpenAI({
        apiKey,
        timeout: timeoutMs,
        maxRetries: 0,
      });

      try {
        const response = await client.responses.parse({
          model,
          input: [
            { role: 'system', content: COVER_LETTER_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildGenerationPrompt({
                deterministicBlock: params.deterministicBlock,
                careerProfileBlock: params.careerProfileBlock,
                jobText: params.jobText,
              }),
            },
          ],
          text: {
            format: zodTextFormat(modelCoverLetterSchema, COVER_LETTER_SCHEMA_NAME),
          },
        });

        if (response.output_parsed === null) {
          throw new CoverLetterAiError('AI_REFUSED', false);
        }

        const parsed = modelCoverLetterSchema.safeParse(response.output_parsed);
        if (!parsed.success) {
          throw new CoverLetterAiError('AI_INVALID_RESPONSE', true);
        }

        return { ...parsed.data, schemaVersion: COVER_LETTER_SCHEMA_VERSION };
      } catch (error) {
        const mapped = mapProviderError(error);
        if (mapped.code !== 'AI_REFUSED' && mapped.code !== 'AI_INVALID_RESPONSE') {
          await logImportantError({
            event: 'cover_letter_provider_failed',
            route: '/api/cover-letters',
            error,
            context: { model, provider: AI_PROVIDER_NAME, providerStatus: mapped.providerStatus },
          });
        } else {
          await logImportantError({
            event: 'cover_letter_invalid_output',
            route: '/api/cover-letters',
            context: { model, provider: AI_PROVIDER_NAME, code: mapped.code },
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
export type CoverLetterAiProviderFactory = () => CoverLetterAiProvider;

let providerFactory: CoverLetterAiProviderFactory | null = null;

/** Test-only override. Pass null to restore the real provider. */
export function __setCoverLetterAiProviderFactory(
  factory: CoverLetterAiProviderFactory | null,
): void {
  providerFactory = factory;
}

export function resolveCoverLetterAiProvider(): CoverLetterAiProvider {
  return providerFactory ? providerFactory() : createOpenAiCoverLetterProvider();
}
