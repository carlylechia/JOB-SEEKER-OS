/**
 * Central AI model registry.
 *
 * Every AI-backed feature resolves its model here. Before this module each
 * client read its own environment variable, so answering "which model writes a
 * cover letter?" or "which model extracted this resume?" meant searching the
 * codebase. The registry is now the single read point.
 *
 * Resolution order, most specific first:
 *
 *   1. `AI_MODEL_OVERRIDES` — one JSON object for deployment-wide, per-feature
 *      overrides, e.g. `{"APPLICATION_MATERIALS":"gpt-4.1"}`.
 *   2. The feature's legacy environment variable (kept working forever so an
 *      existing deployment does not change behaviour on upgrade).
 *   3. The registry default.
 *
 * This is a model-name registry, not a second credit ledger or billing table.
 * All metering stays in `UsageRecord`.
 */

export const AI_MODEL_TASKS = [
  'RESUME_EXTRACTION',
  'JOB_INGESTION',
  'JOB_INTELLIGENCE',
  'RESUME_OPTIMIZATION',
  'APPLICATION_MATERIALS',
  'INTERVIEW_PREP',
  'CAREER_COACH',
  'EXTENSION_AUTOFILL',
] as const;

export type AiModelTask = (typeof AI_MODEL_TASKS)[number];

export type AiModelSource = 'OVERRIDE' | 'ENV' | 'FALLBACK_ENV' | 'DEFAULT';

type ModelTaskConfig = {
  label: string;
  defaultModel: string;
  envVar: string;
  /** Used only when the primary env var is unset. */
  fallbackEnvVar?: string;
};

export const AI_MODEL_CONFIG: Record<AiModelTask, ModelTaskConfig> = {
  RESUME_EXTRACTION: {
    label: 'Resume extraction',
    defaultModel: 'gpt-4o-mini',
    envVar: 'RESUME_INTELLIGENCE_MODEL',
  },
  JOB_INGESTION: {
    label: 'Job ingestion',
    defaultModel: 'gpt-4.1-mini',
    envVar: 'JOB_INGESTION_MODEL',
  },
  JOB_INTELLIGENCE: {
    label: 'Job intelligence',
    defaultModel: 'gpt-4.1-mini',
    envVar: 'JOB_INTELLIGENCE_MODEL',
  },
  RESUME_OPTIMIZATION: {
    label: 'Resume optimization',
    defaultModel: 'gpt-4.1-mini',
    envVar: 'RESUME_OPTIMIZATION_MODEL',
  },
  APPLICATION_MATERIALS: {
    label: 'Application materials',
    defaultModel: 'gpt-4.1-mini',
    envVar: 'APPLICATION_MATERIALS_MODEL',
  },
  INTERVIEW_PREP: {
    label: 'Interview preparation',
    defaultModel: 'gpt-4.1-mini',
    envVar: 'INTERVIEW_PREP_MODEL',
  },
  CAREER_COACH: {
    label: 'Career coach',
    defaultModel: 'gpt-4.1-mini',
    envVar: 'CAREER_COACH_MODEL',
  },
  EXTENSION_AUTOFILL: {
    label: 'Extension screening answers',
    defaultModel: 'gpt-4.1-mini',
    envVar: 'AI_AUTOFILL_MODEL',
    fallbackEnvVar: 'RESUME_OPTIMIZATION_MODEL',
  },
};

/** Backwards-compatible aliases for callers that already export a default. */
export const AI_MODEL_DEFAULTS: Record<AiModelTask, string> = Object.fromEntries(
  AI_MODEL_TASKS.map((task) => [task, AI_MODEL_CONFIG[task].defaultModel]),
) as Record<AiModelTask, string>;

export type ResolvedAiModel = {
  task: AiModelTask;
  label: string;
  model: string;
  source: AiModelSource;
  envVar: string;
  fallbackEnvVar?: string;
  defaultModel: string;
};

export type ResolveAiModelOptions = {
  /** Injectable for tests. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Injectable for tests. Defaults to parsing `AI_MODEL_OVERRIDES`. */
  overrides?: Record<string, unknown> | null;
};

/**
 * A model name is a short identifier, never a URL or a payload. Rejecting
 * control characters and excessive length keeps a malformed environment value
 * from reaching an HTTP header or a provider request.
 */
export function isSafeModelName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= 120 &&
    /^[A-Za-z0-9._:-]+$/.test(value.trim())
  );
}

function parseOverrides(
  env: Record<string, string | undefined>,
  explicit?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (explicit !== undefined) return explicit;
  const raw = env.AI_MODEL_OVERRIDES?.trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function resolveAiModel(
  task: AiModelTask,
  options: ResolveAiModelOptions = {},
): ResolvedAiModel {
  const env = options.env ?? process.env;
  const config = AI_MODEL_CONFIG[task];
  const overrides = parseOverrides(env, options.overrides);

  const overrideValue = overrides?.[task];
  if (isSafeModelName(overrideValue)) {
    return {
      task,
      label: config.label,
      model: overrideValue.trim(),
      source: 'OVERRIDE',
      envVar: config.envVar,
      fallbackEnvVar: config.fallbackEnvVar,
      defaultModel: config.defaultModel,
    };
  }

  const primary = env[config.envVar]?.trim();
  if (isSafeModelName(primary)) {
    return {
      task,
      label: config.label,
      model: primary.trim(),
      source: 'ENV',
      envVar: config.envVar,
      fallbackEnvVar: config.fallbackEnvVar,
      defaultModel: config.defaultModel,
    };
  }

  const fallback = config.fallbackEnvVar ? env[config.fallbackEnvVar]?.trim() : undefined;
  if (isSafeModelName(fallback)) {
    return {
      task,
      label: config.label,
      model: fallback.trim(),
      source: 'FALLBACK_ENV',
      envVar: config.envVar,
      fallbackEnvVar: config.fallbackEnvVar,
      defaultModel: config.defaultModel,
    };
  }

  return {
    task,
    label: config.label,
    model: config.defaultModel,
    source: 'DEFAULT',
    envVar: config.envVar,
    fallbackEnvVar: config.fallbackEnvVar,
    defaultModel: config.defaultModel,
  };
}

/** The common case: just the model name. */
export function getAiModel(task: AiModelTask, options?: ResolveAiModelOptions): string {
  return resolveAiModel(task, options).model;
}

/** Every feature's effective model, for diagnostics and admin display. */
export function describeAiModelRegistry(
  options: ResolveAiModelOptions = {},
): ResolvedAiModel[] {
  return AI_MODEL_TASKS.map((task) => resolveAiModel(task, options));
}

/** True when a task name came from configuration rather than the default. */
export function isAiModelOverridden(task: AiModelTask, options?: ResolveAiModelOptions): boolean {
  return resolveAiModel(task, options).source !== 'DEFAULT';
}
