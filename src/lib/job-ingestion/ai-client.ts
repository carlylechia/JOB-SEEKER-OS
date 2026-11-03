/**
 * AI provider boundary for job capture.
 *
 * Follows the same rules as job intelligence and resume intelligence:
 * schema-constrained output, no tools, a closed error vocabulary, and a
 * test-only factory seam. The difference is the input: text plus up to three
 * images, so a screenshot or job flyer can be captured as easily as a URL.
 */

import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { logImportantError } from '@/lib/observability';
import { toDataUrl, type ValidatedImage } from './images';
import {
  INGESTION_SCHEMA_NAME,
  INGESTION_SYSTEM_PROMPT,
  buildIngestionPrompt,
  modelIngestionSchema,
  type ModelIngestion,
} from './schema';

export const DEFAULT_JOB_INGESTION_MODEL = 'gpt-4.1-mini';
export const DEFAULT_JOB_INGESTION_TIMEOUT_MS = 30_000;
export const JOB_INGESTION_PROVIDER_NAME = 'openai';

export function getJobIngestionModel(): string {
  return process.env.JOB_INGESTION_MODEL?.trim() || DEFAULT_JOB_INGESTION_MODEL;
}

export function getJobIngestionTimeoutMs(): number {
  const configured = Number(process.env.JOB_INGESTION_AI_TIMEOUT_MS ?? '');
  if (Number.isFinite(configured) && configured >= 5_000 && configured <= 60_000) {
    return configured;
  }
  return DEFAULT_JOB_INGESTION_TIMEOUT_MS;
}

export type JobIngestionErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_TIMEOUT'
  | 'AI_RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'AI_REFUSED'
  | 'AI_INVALID_RESPONSE';

const ERROR_MESSAGES: Record<JobIngestionErrorCode, string> = {
  AI_NOT_CONFIGURED: 'AI job capture is not configured on this deployment.',
  AI_TIMEOUT: 'AI job capture took too long. Try a shorter description or fewer images.',
  AI_RATE_LIMITED: 'AI job capture is busy right now. Try again in a moment.',
  AI_UNAVAILABLE: 'AI job capture is temporarily unavailable.',
  AI_REFUSED: 'AI could not read this posting. Check that the text or screenshot is a job advert.',
  AI_INVALID_RESPONSE: 'AI returned an unusable result. Try again.',
};

export class JobIngestionAiError extends Error {
  readonly code: JobIngestionErrorCode;
  readonly retryable: boolean;
  readonly providerStatus?: number;

  constructor(code: JobIngestionErrorCode, retryable: boolean, providerStatus?: number) {
    super(`Job capture failed: ${code}`);
    this.name = 'JobIngestionAiError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }

  get userMessage() {
    return ERROR_MESSAGES[this.code];
  }
}

export class JobIngestionAiNotConfiguredError extends JobIngestionAiError {
  constructor() {
    super('AI_NOT_CONFIGURED', false);
    this.name = 'JobIngestionAiNotConfiguredError';
  }
}

export type JobIngestionAiProvider = {
  readonly name: string;
  readonly model: string;
  extract(params: {
    text: string;
    jobUrl?: string;
    images: ValidatedImage[];
  }): Promise<ModelIngestion>;
};

function mapProviderError(error: unknown): JobIngestionAiError {
  if (error instanceof JobIngestionAiError) return error;

  const status = (() => {
    const candidate = error as { status?: unknown } | null;
    return typeof candidate?.status === 'number' ? candidate.status : undefined;
  })();

  if (status === 429) return new JobIngestionAiError('AI_RATE_LIMITED', true, status);
  if (status === 401 || status === 403) {
    return new JobIngestionAiError('AI_NOT_CONFIGURED', false, status);
  }
  if (status === 400 || status === 422) {
    return new JobIngestionAiError('AI_UNAVAILABLE', false, status);
  }
  if (status !== undefined && status >= 500) {
    return new JobIngestionAiError('AI_UNAVAILABLE', true, status);
  }

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new JobIngestionAiError('AI_TIMEOUT', true);
  }
  if (name === 'APIConnectionError') return new JobIngestionAiError('AI_UNAVAILABLE', true);
  return new JobIngestionAiError('AI_UNAVAILABLE', true);
}

export function createOpenAiJobIngestionProvider(options?: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): JobIngestionAiProvider {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) throw new JobIngestionAiNotConfiguredError();

  const model = options?.model ?? getJobIngestionModel();
  const timeoutMs = options?.timeoutMs ?? getJobIngestionTimeoutMs();

  return {
    name: JOB_INGESTION_PROVIDER_NAME,
    model,

    async extract(params): Promise<ModelIngestion> {
      const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });
      const content = [
        {
          type: 'input_text' as const,
          text: buildIngestionPrompt({
            text: params.text,
            jobUrl: params.jobUrl,
            imageCount: params.images.length,
          }),
        },
        ...params.images.map((image) => ({
          type: 'input_image' as const,
          image_url: toDataUrl(image),
          detail: 'high' as const,
        })),
      ];

      try {
        const response = await client.responses.parse({
          model,
          input: [
            { role: 'system', content: INGESTION_SYSTEM_PROMPT },
            { role: 'user', content },
          ],
          text: {
            format: zodTextFormat(modelIngestionSchema, INGESTION_SCHEMA_NAME),
          },
        });

        if (response.output_parsed === null) {
          throw new JobIngestionAiError('AI_REFUSED', false);
        }

        const parsed = modelIngestionSchema.safeParse(response.output_parsed);
        if (!parsed.success) {
          throw new JobIngestionAiError('AI_INVALID_RESPONSE', true);
        }
        return parsed.data;
      } catch (error) {
        const mapped = mapProviderError(error);
        await logImportantError({
          event:
            mapped.code === 'AI_REFUSED' || mapped.code === 'AI_INVALID_RESPONSE'
              ? 'job_ingestion_invalid_output'
              : 'job_ingestion_provider_failed',
          route: '/api/ingest-job',
          error: mapped.code === 'AI_REFUSED' || mapped.code === 'AI_INVALID_RESPONSE' ? undefined : error,
          context: {
            model,
            provider: JOB_INGESTION_PROVIDER_NAME,
            providerStatus: mapped.providerStatus,
            code: mapped.code,
            images: params.images.length,
          },
        });
        throw mapped;
      }
    },
  };
}

export type JobIngestionAiProviderFactory = () => JobIngestionAiProvider;

let providerFactory: JobIngestionAiProviderFactory | null = null;

/** Test-only override. Pass null to restore the real provider. */
export function __setJobIngestionAiProviderFactory(factory: JobIngestionAiProviderFactory | null) {
  providerFactory = factory;
}

export function resolveJobIngestionAiProvider(): JobIngestionAiProvider {
  return providerFactory ? providerFactory() : createOpenAiJobIngestionProvider();
}
