/**
 * Server-side AI provider boundary for job intelligence.
 *
 * A sibling of `src/lib/resume/ai-client.ts`, following the same pattern rather
 * than forking a second SDK integration. It is a separate module because the
 * two features have genuinely different contracts: the resume provider's
 * interface is `extract(resumeText)`, and a job analysis is not a resume
 * extraction. Coupling them would force one feature's shape onto the other and
 * make both harder to change.
 *
 * What is shared with the resume boundary, and why:
 *
 *  - Schema-constrained output via `responses.parse()` + `zodTextFormat()`.
 *    Confirmed against current OpenAI documentation as the mechanism for the
 *    Responses API: the provider guarantees the shape, and we validate anyway
 *    because "the provider said it conforms" is not a guarantee.
 *  - **No tools.** No function calling, no web search, no code interpreter. The
 *    model can only return the object we asked for. This is the control that
 *    makes prompt injection a wording problem rather than a security one.
 *  - A closed set of error codes. Provider messages, request ids and stack
 *    traces never reach the browser.
 */

import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { logImportantError } from '@/lib/observability';
import {
  ANALYSIS_ERROR_MESSAGES,
  ANALYSIS_SCHEMA_NAME,
  ANALYSIS_SCHEMA_VERSION,
  modelAnalysisSchema,
  type AnalysisErrorCode,
  type ModelAnalysis,
} from './schema';
import { JOB_INTELLIGENCE_AI_TIMEOUT_MS } from './limits';
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisPrompt,
} from './prompt';

/**
 * Model used for job analysis.
 *
 * Defaults to `gpt-4.1-mini`. Chosen by measurement, not by reputation: each
 * candidate was run against the REAL strict schema with a realistic full-size
 * posting, then scored on schema conformance, requirement coverage, latency
 * and measured cost per analysis.
 *
 *   gpt-4.1-mini   ~12-15s  ~$0.005   cautious with UNKNOWN, surfaces limitations
 *   gpt-4o-mini    ~15s     ~$0.0016  cheap, but over-claims MATCH more often
 *   gpt-5.4-mini   ~11s     ~$0.018   thorough, ~3.4x the cost for a similar answer
 *   gpt-6-luna     56-62s   ~$0.003   most cautious, but exceeds our 45s timeout
 *
 * `gpt-4.1-mini` is the balance point. This output drives a real career
 * decision, so its willingness to say "we cannot tell" is worth more than
 * three quarters of a cent — and it is still 3.4x cheaper than the previous
 * default. Override with `JOB_INTELLIGENCE_MODEL`, read here and nowhere
 * else, so changing model never means hunting through the codebase.
 */
export const DEFAULT_JOB_INTELLIGENCE_MODEL = 'gpt-4.1-mini';

export function getJobIntelligenceModel(): string {
  return process.env.JOB_INTELLIGENCE_MODEL?.trim() || DEFAULT_JOB_INTELLIGENCE_MODEL;
}

/** Name recorded on each analysis so a result can be traced to its model. */
export const AI_PROVIDER_NAME = 'openai';

/** A failure the user can be told something useful about, and nothing more. */
export class JobIntelligenceAiError extends Error {
  readonly code: AnalysisErrorCode;
  readonly retryable: boolean;
  /** Provider-specific status, for logs. Never sent to the browser. */
  readonly providerStatus?: number;

  constructor(code: AnalysisErrorCode, retryable: boolean, providerStatus?: number) {
    super(`Job intelligence analysis failed: ${code}`);
    this.name = 'JobIntelligenceAiError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }

  /** Safe, user-facing copy. No provider detail crosses this boundary. */
  get userMessage(): string {
    return ANALYSIS_ERROR_MESSAGES[this.code];
  }
}

export class JobIntelligenceAiNotConfiguredError extends JobIntelligenceAiError {
  constructor() {
    super('AI_NOT_CONFIGURED', false);
    this.name = 'JobIntelligenceAiNotConfiguredError';
  }
}

/** What the service layer needs from an AI provider. */
export type JobIntelligenceAiProvider = {
  readonly name: string;
  readonly model: string;
  analyse(params: {
    deterministicBlock: string;
    careerProfileBlock: string;
    jobText: string;
  }): Promise<ModelAnalysis>;
};

/**
 * Translate a provider failure into a code the product can act on.
 *
 * The message and any provider detail stay in the server log; the caller only
 * ever receives the code.
 */
function mapProviderError(error: unknown): JobIntelligenceAiError {
  if (error instanceof JobIntelligenceAiError) return error;

  const status = (() => {
    const candidate = error as { status?: unknown } | null;
    return typeof candidate?.status === 'number' ? candidate.status : undefined;
  })();

  if (status === 429) return new JobIntelligenceAiError('AI_RATE_LIMITED', true, status);
  if (status === 401 || status === 403) {
    // Misconfiguration, not a user problem, and not fixed by retrying.
    return new JobIntelligenceAiError('AI_NOT_CONFIGURED', false, status);
  }
  if (status === 400 || status === 422) {
    return new JobIntelligenceAiError('AI_UNAVAILABLE', false, status);
  }
  if (status !== undefined && status >= 500) {
    return new JobIntelligenceAiError('AI_UNAVAILABLE', true, status);
  }

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new JobIntelligenceAiError('AI_TIMEOUT', true);
  }
  if (name === 'APIConnectionError') return new JobIntelligenceAiError('AI_UNAVAILABLE', true);

  return new JobIntelligenceAiError('AI_UNAVAILABLE', true);
}

/**
 * The real provider.
 *
 * The client is created per call rather than cached at module scope so a
 * rotated API key does not require a redeploy, and so a request that is never
 * made never constructs a client.
 */
export function createOpenAiJobIntelligenceProvider(options?: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): JobIntelligenceAiProvider {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new JobIntelligenceAiNotConfiguredError();
  }

  const model = options?.model ?? getJobIntelligenceModel();
  const timeoutMs = options?.timeoutMs ?? JOB_INTELLIGENCE_AI_TIMEOUT_MS;

  return {
    name: AI_PROVIDER_NAME,
    model,

    async analyse(params): Promise<ModelAnalysis> {
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
            { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildAnalysisPrompt({
                deterministicBlock: params.deterministicBlock,
                careerProfileBlock: params.careerProfileBlock,
                jobText: params.jobText,
              }),
            },
          ],
          text: {
            format: zodTextFormat(modelAnalysisSchema, ANALYSIS_SCHEMA_NAME),
          },
          // No tools, no web search, no code interpreter: the model can only
          // return the object we asked for.
        });

        // A refusal produces no parsed output. Surfacing it as a distinct,
        // non-retryable state beats pretending the posting was empty.
        if (response.output_parsed === null) {
          throw new JobIntelligenceAiError('AI_REFUSED', false);
        }

        // Validate on our side regardless of what the provider guarantees.
        // A schema the provider quietly relaxed, or an unexpected shape, fails
        // here rather than reaching the database.
        const parsed = modelAnalysisSchema.safeParse(response.output_parsed);
        if (!parsed.success) {
          throw new JobIntelligenceAiError('AI_INVALID_RESPONSE', true);
        }

        return {
          ...parsed.data,
          // The contract version is ours, not the model's. Whatever number the
          // model echoed is ignored, so a cached result can never claim to be
          // a newer contract than it is.
          schemaVersion: ANALYSIS_SCHEMA_VERSION,
        };
      } catch (error) {
        const mapped = mapProviderError(error);
        if (mapped.code !== 'AI_REFUSED' && mapped.code !== 'AI_INVALID_RESPONSE') {
          await logImportantError({
            event: 'job_intelligence_provider_failed',
            route: '/api/jobs/[id]/intelligence',
            error,
            context: { model, provider: AI_PROVIDER_NAME, providerStatus: mapped.providerStatus },
          });
        } else {
          // A refusal or a schema miss is a normal outcome, not an incident,
          // so it is logged without raising a Discord alert.
          await logImportantError({
            event: 'job_intelligence_invalid_output',
            route: '/api/jobs/[id]/intelligence',
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
export type JobIntelligenceAiProviderFactory = () => JobIntelligenceAiProvider;

let providerFactory: JobIntelligenceAiProviderFactory | null = null;

/** Test-only override. Pass null to restore the real provider. */
export function __setJobIntelligenceAiProviderFactory(
  factory: JobIntelligenceAiProviderFactory | null,
): void {
  providerFactory = factory;
}

export function resolveJobIntelligenceAiProvider(): JobIntelligenceAiProvider {
  return providerFactory ? providerFactory() : createOpenAiJobIntelligenceProvider();
}