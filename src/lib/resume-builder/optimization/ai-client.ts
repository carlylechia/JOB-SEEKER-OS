/**
 * Server-side AI provider boundary for resume optimisation.
 *
 * A third sibling of `src/lib/resume/ai-client.ts` and
 * `src/lib/job-intelligence/ai-client.ts`, following the same pattern rather
 * than forking a second SDK integration or bolting this feature onto either
 * existing one. They are separate modules because the three features have
 * genuinely different contracts: an extraction is not a job analysis, and
 * neither is a rewrite proposal. Coupling them would force one feature's shape
 * onto the others.
 *
 * What is shared, and why:
 *  - Schema-constrained output via `responses.parse()` + `zodTextFormat()`.
 *  - **No tools.** No function calling, no web search, no code interpreter. The
 *    model can only return the object we asked for. This is the control that
 *    makes prompt injection a wording problem rather than a security one.
 *  - A closed set of error codes. Provider messages, request ids and stack
 *    traces never reach the browser.
 *  - `__set…ProviderFactory` so the test suite can substitute a fake without an
 *    API key and without a network call.
 */

import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { logImportantError } from '@/lib/observability';
import {
  modelProposalSchema,
  OPTIMIZATION_SCHEMA_NAME,
  OPTIMIZATION_SCHEMA_VERSION,
  type ModelProposal,
  type OptimizationErrorCode,
} from './schema';
import { OPTIMIZATION_AI_TIMEOUT_MS } from './limits';
import { OPTIMIZATION_SYSTEM_PROMPT, buildOptimizationPrompt } from './prompt';

/**
 * Model used for optimisation.
 *
 * Defaults to `gpt-4.1-mini`, the same choice as job intelligence, and for the
 * same reason: this output is read by a person deciding whether to send a
 * document to an employer. Its willingness to say "I would need the measured
 * result to make this stronger" is worth more here than a fraction of a cent,
 * and it is the model already trusted for the adjacent feature.
 *
 * Override with `RESUME_OPTIMIZATION_MODEL`, read here and nowhere else.
 */
export const DEFAULT_OPTIMIZATION_MODEL = 'gpt-4.1-mini';

export function getOptimizationModel(): string {
  return process.env.RESUME_OPTIMIZATION_MODEL?.trim() || DEFAULT_OPTIMIZATION_MODEL;
}

export const AI_PROVIDER_NAME = 'openai';

/** A failure the user can be told something useful about, and nothing more. */
export class ResumeOptimizationAiError extends Error {
  readonly code: OptimizationErrorCode;
  readonly retryable: boolean;
  /** Provider-specific status, for logs. Never sent to the browser. */
  readonly providerStatus?: number;

  constructor(code: OptimizationErrorCode, retryable: boolean, providerStatus?: number) {
    super(`Resume optimization failed: ${code}`);
    this.name = 'ResumeOptimizationAiError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }
}

export class ResumeOptimizationAiNotConfiguredError extends ResumeOptimizationAiError {
  constructor() {
    super('AI_NOT_CONFIGURED', false);
    this.name = 'ResumeOptimizationAiNotConfiguredError';
  }
}

export type ResumeOptimizationAiProvider = {
  readonly name: string;
  readonly model: string;
  propose(params: {
    deterministicBlock: string;
    careerProfileBlock: string;
    resumeText: string;
    jobText: string;
    careerProfileBlockIncluded: boolean;
  }): Promise<ModelProposal>;
};

function mapProviderError(error: unknown): ResumeOptimizationAiError {
  if (error instanceof ResumeOptimizationAiError) return error;

  const status = (() => {
    const candidate = error as { status?: unknown } | null;
    return typeof candidate?.status === 'number' ? candidate.status : undefined;
  })();

  if (status === 429) return new ResumeOptimizationAiError('AI_RATE_LIMITED', true, status);
  if (status === 401 || status === 403) {
    return new ResumeOptimizationAiError('AI_NOT_CONFIGURED', false, status);
  }
  if (status === 400 || status === 422) {
    return new ResumeOptimizationAiError('AI_UNAVAILABLE', false, status);
  }
  if (status !== undefined && status >= 500) {
    return new ResumeOptimizationAiError('AI_UNAVAILABLE', true, status);
  }

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new ResumeOptimizationAiError('AI_TIMEOUT', true);
  }
  if (name === 'APIConnectionError') return new ResumeOptimizationAiError('AI_UNAVAILABLE', true);

  return new ResumeOptimizationAiError('AI_UNAVAILABLE', true);
}

/**
 * The real provider.
 *
 * The client is created per call rather than cached at module scope, so a
 * rotated API key does not require a redeploy and a request that is never made
 * never constructs a client.
 */
export function createOpenAiOptimizationProvider(options?: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): ResumeOptimizationAiProvider {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new ResumeOptimizationAiNotConfiguredError();
  }

  const model = options?.model ?? getOptimizationModel();
  const timeoutMs = options?.timeoutMs ?? OPTIMIZATION_AI_TIMEOUT_MS;

  return {
    name: AI_PROVIDER_NAME,
    model,

    async propose(params): Promise<ModelProposal> {
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
            { role: 'system', content: OPTIMIZATION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildOptimizationPrompt({
                deterministicBlock: params.deterministicBlock,
                careerProfileBlock: params.careerProfileBlock,
                resumeText: params.resumeText,
                jobText: params.jobText,
                careerProfileBlockIncluded: params.careerProfileBlockIncluded,
              }),
            },
          ],
          text: {
            format: zodTextFormat(modelProposalSchema, OPTIMIZATION_SCHEMA_NAME),
          },
          // No tools, no web search, no code interpreter: the model can only
          // return the object we asked for.
        });

        // A refusal produces no parsed output. Surfacing it as a distinct,
        // non-retryable state beats pretending the resume was empty.
        if (response.output_parsed === null) {
          throw new ResumeOptimizationAiError('AI_REFUSED', false);
        }

        // Validate on our side regardless of what the provider guarantees.
        // Truncated output, a schema the provider quietly relaxed, and an
        // unexpected shape all fail here rather than reaching the database.
        const parsed = modelProposalSchema.safeParse(response.output_parsed);
        if (!parsed.success) {
          throw new ResumeOptimizationAiError('AI_INVALID_RESPONSE', true);
        }

        return {
          ...parsed.data,
          // The contract version is ours, not the model's. Whatever number it
          // echoed is ignored, so a cached result can never claim to be a newer
          // contract than it is.
          schemaVersion: OPTIMIZATION_SCHEMA_VERSION,
        };
      } catch (error) {
        const mapped = mapProviderError(error);
        if (mapped.code !== 'AI_REFUSED' && mapped.code !== 'AI_INVALID_RESPONSE') {
          await logImportantError({
            event: 'resume_optimization_provider_failed',
            route: '/api/resumes/[id]/optimization',
            error,
            context: { model, provider: AI_PROVIDER_NAME, providerStatus: mapped.providerStatus },
          });
        } else {
          // A refusal or a schema miss is a normal outcome, not an incident, so
          // it is logged without raising a Discord alert.
          await logImportantError({
            event: 'resume_optimization_invalid_output',
            route: '/api/resumes/[id]/optimization',
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
export type ResumeOptimizationAiProviderFactory = () => ResumeOptimizationAiProvider;

let providerFactory: ResumeOptimizationAiProviderFactory | null = null;

/** Test-only override. Pass null to restore the real provider. */
export function __setOptimizationAiProviderFactory(
  factory: ResumeOptimizationAiProviderFactory | null,
): void {
  providerFactory = factory;
}

export function resolveOptimizationAiProvider(): ResumeOptimizationAiProvider {
  return providerFactory ? providerFactory() : createOpenAiOptimizationProvider();
}