/**
 * Server-side AI provider boundary.
 *
 * This is the only module that knows an AI provider exists. Everything above it
 * — the orchestration service, the API routes, the tests — depends on the
 * `ResumeAiProvider` interface, not on OpenAI. The next AI feature (job
 * intelligence, cover letters, interview prep) reuses this seam instead of
 * adding a second SDK.
 *
 * Three deliberate choices:
 *
 *  - Schema-constrained output. `responses.parse` with a strict JSON Schema
 *    means the provider guarantees shape, not just valid JSON. We validate
 *    again anyway, because "the provider said it conforms" is not a guarantee.
 *  - No tools. The extraction model gets no function calling, no web search, no
 *    code interpreter. It can only return the object we asked for.
 *  - Errors are mapped to a small closed set of codes. Provider messages,
 *    request ids and stack traces never reach the browser.
 */

import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { logImportantError } from '@/lib/observability';
import {
  careerExtractionSchema,
  EXTRACTION_SCHEMA_NAME,
  EXTRACTION_SCHEMA_VERSION,
  type CareerExtraction,
  type ExtractionErrorCode,
} from './schema';
import { RESUME_AI_TIMEOUT_MS } from './limits';
import { buildExtractionPrompt, EXTRACTION_SYSTEM_PROMPT } from './prompt';

/**
 * Model used for extraction.
 *
 * Defaults to a capable, cost-efficient model: resume parsing is a bounded
 * extraction task run on demand, not a reasoning workload. Override with
 * `RESUME_INTELLIGENCE_MODEL` — the value is read here and nowhere else, so
 * changing model never means hunting through the codebase.
 */
export const DEFAULT_RESUME_MODEL = 'gpt-5.4-mini';

export function getResumeModel(): string {
  return process.env.RESUME_INTELLIGENCE_MODEL?.trim() || DEFAULT_RESUME_MODEL;
}

/** Name recorded on each extraction so a result can be traced to its model. */
export const AI_PROVIDER_NAME = 'openai';

/**
 * A failure the user can be told something useful about, and nothing more.
 * `retryable` is what the UI uses to decide whether to offer a retry.
 */
export class AiProviderError extends Error {
  readonly code: ExtractionErrorCode;
  readonly retryable: boolean;
  /** Provider-specific status, for logs. Never sent to the browser. */
  readonly providerStatus?: number;

  constructor(code: ExtractionErrorCode, retryable: boolean, providerStatus?: number) {
    super(`Resume extraction failed: ${code}`);
    this.name = 'AiProviderError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }
}

export class AiNotConfiguredError extends AiProviderError {
  constructor() {
    super('AI_NOT_CONFIGURED', false);
    this.name = 'AiNotConfiguredError';
  }
}

/** What the service layer needs from an AI provider. */
export type ResumeAiProvider = {
  readonly name: string;
  readonly model: string;
  extract(resumeText: string): Promise<CareerExtraction>;
};

/**
 * Translate a provider failure into a code the product can act on.
 *
 * The message and any provider detail stay in the server log; the caller only
 * ever receives the code.
 */
function mapProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;

  const status = (() => {
    const candidate = error as { status?: unknown } | null;
    return typeof candidate?.status === 'number' ? candidate.status : undefined;
  })();

  if (status === 429) return new AiProviderError('AI_RATE_LIMITED', true, status);
  if (status === 401 || status === 403) {
    // Misconfiguration, not a user problem, and not retryable by retrying.
    return new AiProviderError('AI_NOT_CONFIGURED', false, status);
  }
  if (status === 400 || status === 422) {
    // The request did not conform — a model that does not support this feature,
    // or a schema the provider rejected.
    return new AiProviderError('AI_UNAVAILABLE', false, status);
  }
  if (status !== undefined && status >= 500) {
    return new AiProviderError('AI_UNAVAILABLE', true, status);
  }

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new AiProviderError('AI_TIMEOUT', true);
  }
  if (name === 'APIConnectionError') return new AiProviderError('AI_UNAVAILABLE', true);

  return new AiProviderError('AI_UNAVAILABLE', true);
}

/**
 * The real provider.
 *
 * The client is created per call rather than cached at module scope so that a
 * rotated API key does not require a redeploy, and so a request that is never
 * made never constructs a client.
 */
export function createOpenAiResumeProvider(options?: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): ResumeAiProvider {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new AiNotConfiguredError();
  }

  const model = options?.model ?? getResumeModel();
  const timeoutMs = options?.timeoutMs ?? RESUME_AI_TIMEOUT_MS;

  return {
    name: AI_PROVIDER_NAME,
    model,

    async extract(resumeText: string): Promise<CareerExtraction> {
      const client = new OpenAI({
        apiKey,
        timeout: timeoutMs,
        maxRetries: 0, // Retries are the service layer's decision, not the SDK's.
      });

      try {
        const response = await client.responses.parse({
          model,
          input: [
            { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
            { role: 'user', content: buildExtractionPrompt(resumeText) },
          ],
          text: {
            format: zodTextFormat(careerExtractionSchema, EXTRACTION_SCHEMA_NAME),
          },
          // No tools, no web search, no code interpreter: the model can only
          // return the object we asked for.
        });

        // A refusal produces no parsed output. Surfacing it as a distinct,
        // non-retryable state beats pretending the document was empty.
        if (response.output_parsed === null) {
          throw new AiProviderError('AI_REFUSED', false);
        }

        // Validate on our side regardless of what the provider guarantees.
        // Truncated output, a schema the provider quietly relaxed, and an
        // unexpected shape all fail here rather than reaching the database.
        const parsed = careerExtractionSchema.safeParse(response.output_parsed);
        if (!parsed.success) {
          throw new AiProviderError('AI_INVALID_RESPONSE', true);
        }

        return {
          ...parsed.data,
          // The contract version is ours, not the model's. Whatever number the
          // model echoed is ignored, so a cached result can never claim to be a
          // newer contract than it is.
          schemaVersion: EXTRACTION_SCHEMA_VERSION,
        };
      } catch (error) {
        const mapped = mapProviderError(error);
        if (mapped.code !== 'AI_REFUSED' && mapped.code !== 'AI_INVALID_RESPONSE') {
          await logImportantError({
            event: 'resume_extraction_provider_failed',
            route: '/api/resume/intelligence',
            error,
            context: { model, provider: AI_PROVIDER_NAME, providerStatus: mapped.providerStatus },
          });
        } else {
          // A refusal or a schema miss is a normal outcome, not an incident, so
          // it is logged without raising a Discord alert.
          await logImportantError({
            event: 'resume_extraction_invalid_output',
            route: '/api/resume/intelligence',
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
 * Kept as a seam so tests can substitute a fake without a key and without a
 * network call, and so the service layer never imports the SDK directly.
 */
export type ResumeAiProviderFactory = () => ResumeAiProvider;

let providerFactory: ResumeAiProviderFactory | null = null;

/** Test-only override. Pass null to restore the real provider. */
export function __setResumeAiProviderFactory(factory: ResumeAiProviderFactory | null): void {
  providerFactory = factory;
}

export function resolveResumeAiProvider(): ResumeAiProvider {
  return providerFactory ? providerFactory() : createOpenAiResumeProvider();
}