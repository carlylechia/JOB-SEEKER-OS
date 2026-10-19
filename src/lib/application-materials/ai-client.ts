/**
 * Server-side AI provider boundary for application materials.
 *
 * A sibling of `src/lib/job-intelligence/ai-client.ts` and
 * `src/lib/resume-builder/optimization/ai-client.ts`, following the same
 * pattern rather than forking a third SDK integration. It is a separate module
 * because the contract genuinely differs: the other two return analysis about
 * data, this one returns prose a human will put their name to.
 *
 * What is shared with those boundaries, and why:
 *
 *  - Schema-constrained output via `responses.parse()` + `zodTextFormat()`.
 *    The provider guarantees the shape, and we validate anyway, because "the
 *    provider said it conforms" is not a guarantee.
 *  - **No tools.** No function calling, no web search, no code interpreter. The
 *    model can only return the object we asked for. This is the control that
 *    makes prompt injection a wording problem rather than a security one, and it
 *    is the reason a hostile job description cannot cause a database write.
 *  - A closed set of error codes. Provider messages, request ids and stack
 *    traces never reach the browser.
 *  - The client is constructed per call rather than cached at module scope, so a
 *    rotated key needs no redeploy.
 */

import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { logImportantError } from '@/lib/observability';
import {
  MATERIAL_ERROR_MESSAGES,
  MATERIAL_SCHEMA_NAME,
  MATERIAL_SCHEMA_VERSION,
  modelMaterialSchema,
  type MaterialErrorCode,
  type ModelMaterial,
} from './schema';
import { MATERIAL_AI_TIMEOUT_MS } from './limits';
import { MATERIAL_SYSTEM_PROMPT, type PromptInputs } from './prompt';

/**
 * Model used for writing application materials.
 *
 * Defaults to `gpt-4.1-mini`, the same model the job-intelligence release
 * measured and adopted, for the same reason: writing that will be sent to a
 * real employer is exactly the class of output where caution is worth more
 * than a fraction of a cent. Override with `APPLICATION_MATERIALS_MODEL`,
 * read here and nowhere else.
 */
export const DEFAULT_APPLICATION_MATERIALS_MODEL = 'gpt-4.1-mini';

export function getApplicationMaterialsModel(): string {
  return (
    process.env.APPLICATION_MATERIALS_MODEL?.trim() || DEFAULT_APPLICATION_MATERIALS_MODEL
  );
}

/** Name recorded on each material so a draft can be traced to its model. */
export const AI_PROVIDER_NAME = 'openai';

/** A failure the user can be told something useful about, and nothing more. */
export class ApplicationMaterialAiError extends Error {
  readonly code: MaterialErrorCode;
  readonly retryable: boolean;
  /** Provider-specific status, for logs. Never sent to the browser. */
  readonly providerStatus?: number;

  constructor(code: MaterialErrorCode, retryable: boolean, providerStatus?: number) {
    super(`Application material generation failed: ${code}`);
    this.name = 'ApplicationMaterialAiError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }

  /** Safe, user-facing copy. No provider detail crosses this boundary. */
  get userMessage(): string {
    return MATERIAL_ERROR_MESSAGES[this.code];
  }
}

export class ApplicationMaterialAiNotConfiguredError extends ApplicationMaterialAiError {
  constructor() {
    super('AI_NOT_CONFIGURED', false);
    this.name = 'ApplicationMaterialAiNotConfiguredError';
  }
}

/** What the service layer needs from an AI provider. */
export type ApplicationMaterialAiProvider = {
  readonly name: string;
  readonly model: string;
  write(params: { systemPrompt: string; userPrompt: string }): Promise<ModelMaterial>;
};

/**
 * Translate a provider failure into a code the product can act on.
 *
 * The message and any provider detail stay in the server log; the caller only
 * ever receives the code.
 */
function mapProviderError(error: unknown): ApplicationMaterialAiError {
  if (error instanceof ApplicationMaterialAiError) return error;

  const status = (() => {
    const candidate = error as { status?: unknown } | null;
    return typeof candidate?.status === 'number' ? candidate.status : undefined;
  })();

  if (status === 429) return new ApplicationMaterialAiError('AI_RATE_LIMITED', true, status);
  if (status === 401 || status === 403) {
    return new ApplicationMaterialAiError('AI_NOT_CONFIGURED', false, status);
  }
  if (status === 400 || status === 422) {
    return new ApplicationMaterialAiError('AI_UNAVAILABLE', false, status);
  }
  if (status !== undefined && status >= 500) {
    return new ApplicationMaterialAiError('AI_UNAVAILABLE', true, status);
  }

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new ApplicationMaterialAiError('AI_TIMEOUT', true);
  }
  if (name === 'APIConnectionError') {
    return new ApplicationMaterialAiError('AI_UNAVAILABLE', true);
  }

  return new ApplicationMaterialAiError('AI_UNAVAILABLE', true);
}

/** The real provider. */
export function createOpenAiApplicationMaterialProvider(options?: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): ApplicationMaterialAiProvider {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new ApplicationMaterialAiNotConfiguredError();
  }

  const model = options?.model ?? getApplicationMaterialsModel();
  const timeoutMs = options?.timeoutMs ?? MATERIAL_AI_TIMEOUT_MS;

  return {
    name: AI_PROVIDER_NAME,
    model,

    async write(params): Promise<ModelMaterial> {
      const client = new OpenAI({
        apiKey,
        timeout: timeoutMs,
        // Retries are the service layer's decision, not the SDK's.
        maxRetries: 0,
      });

      try {
        const response = await client.responses.parse({
          model,
          input: [
            { role: 'system', content: params.systemPrompt || MATERIAL_SYSTEM_PROMPT },
            { role: 'user', content: params.userPrompt },
          ],
          text: { format: zodTextFormat(modelMaterialSchema, MATERIAL_SCHEMA_NAME) },
          // No tools, no web search, no code interpreter: the model can only
          // return the object we asked for.
        });

        if (response.output_parsed === null) {
          throw new ApplicationMaterialAiError('AI_REFUSED', false);
        }

        // Validate on our side regardless of what the provider guarantees.
        const parsed = modelMaterialSchema.safeParse(response.output_parsed);
        if (!parsed.success) {
          throw new ApplicationMaterialAiError('AI_INVALID_RESPONSE', true);
        }

        return {
          ...parsed.data,
          schemaVersion: MATERIAL_SCHEMA_VERSION,
        };
      } catch (error) {
        const mapped = mapProviderError(error);
        if (mapped.code !== 'AI_REFUSED' && mapped.code !== 'AI_INVALID_RESPONSE') {
          await logImportantError({
            event: 'application_material_provider_failed',
            route: '/api/application-materials',
            error,
            context: { model, provider: AI_PROVIDER_NAME, providerStatus: mapped.providerStatus },
          });
        } else {
          await logImportantError({
            event: 'application_material_invalid_output',
            route: '/api/application-materials',
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
export type ApplicationMaterialAiProviderFactory = () => ApplicationMaterialAiProvider;

let providerFactory: ApplicationMaterialAiProviderFactory | null = null;

/** Test-only override. Pass null to restore the real provider. */
export function __setApplicationMaterialAiProviderFactory(
  factory: ApplicationMaterialAiProviderFactory | null,
): void {
  providerFactory = factory;
}

export function resolveApplicationMaterialAiProvider(): ApplicationMaterialAiProvider {
  return providerFactory ? providerFactory() : createOpenAiApplicationMaterialProvider();
}

export { buildMaterialPrompt, MATERIAL_SYSTEM_PROMPT, type PromptInputs } from './prompt';
