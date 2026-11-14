/**
 * Central AI model registry and deterministic quality checks.
 *
 * No provider is called. These are pure functions over configuration and text.
 */

import { describe, it, expect } from './harness';
import {
  AI_MODEL_CONFIG,
  AI_MODEL_DEFAULTS,
  AI_MODEL_TASKS,
  describeAiModelRegistry,
  getAiModel,
  isAiModelOverridden,
  isSafeModelName,
  resolveAiModel,
} from '@/lib/ai/model-registry';
import { assessGeneratedText } from '@/lib/ai/quality';

describe('AI model registry', () => {
  it('defines a default and a legacy env var for every task', () => {
    expect(AI_MODEL_TASKS.length).toBeGreaterThan(0);
    for (const task of AI_MODEL_TASKS) {
      const config = AI_MODEL_CONFIG[task];
      expect(config.envVar.endsWith('_MODEL')).toBe(true);
      expect(config.defaultModel.length).toBeGreaterThan(0);
      expect(AI_MODEL_DEFAULTS[task]).toBe(config.defaultModel);
    }
  });

  it('keeps the previously shipped defaults', () => {
    expect(getAiModel('RESUME_EXTRACTION', { env: {} })).toBe('gpt-4o-mini');
    for (const task of AI_MODEL_TASKS) {
      if (task === 'RESUME_EXTRACTION') continue;
      expect(getAiModel(task, { env: {} })).toBe('gpt-4.1-mini');
    }
  });

  it('reads each feature legacy env var', () => {
    const env = {
      RESUME_INTELLIGENCE_MODEL: 'resume-model',
      JOB_INGESTION_MODEL: 'ingest-model',
      JOB_INTELLIGENCE_MODEL: 'intel-model',
      RESUME_OPTIMIZATION_MODEL: 'optimize-model',
      APPLICATION_MATERIALS_MODEL: 'writing-model',
      INTERVIEW_PREP_MODEL: 'interview-model',
      CAREER_COACH_MODEL: 'coach-model',
      AI_AUTOFILL_MODEL: 'autofill-model',
    };

    expect(getAiModel('RESUME_EXTRACTION', { env })).toBe('resume-model');
    expect(getAiModel('JOB_INGESTION', { env })).toBe('ingest-model');
    expect(getAiModel('JOB_INTELLIGENCE', { env })).toBe('intel-model');
    expect(getAiModel('RESUME_OPTIMIZATION', { env })).toBe('optimize-model');
    expect(getAiModel('APPLICATION_MATERIALS', { env })).toBe('writing-model');
    expect(getAiModel('INTERVIEW_PREP', { env })).toBe('interview-model');
    expect(getAiModel('CAREER_COACH', { env })).toBe('coach-model');
    expect(getAiModel('EXTENSION_AUTOFILL', { env })).toBe('autofill-model');
  });

  it('lets the central override win over the legacy env var', () => {
    const resolved = resolveAiModel('APPLICATION_MATERIALS', {
      env: { APPLICATION_MATERIALS_MODEL: 'env-model' },
      overrides: { APPLICATION_MATERIALS: 'override-model' },
    });

    expect(resolved.model).toBe('override-model');
    expect(resolved.source).toBe('OVERRIDE');
  });

  it('parses AI_MODEL_OVERRIDES from the environment', () => {
    const resolved = resolveAiModel('INTERVIEW_PREP', {
      env: { AI_MODEL_OVERRIDES: '{"INTERVIEW_PREP":"premium-model"}' },
    });

    expect(resolved.model).toBe('premium-model');
    expect(resolved.source).toBe('OVERRIDE');
  });

  it('ignores malformed override JSON and unsafe model names', () => {
    expect(
      getAiModel('JOB_INTELLIGENCE', { env: { AI_MODEL_OVERRIDES: 'not json' } }),
    ).toBe('gpt-4.1-mini');

    expect(
      getAiModel('JOB_INTELLIGENCE', {
        env: { JOB_INTELLIGENCE_MODEL: 'model\nwith-newline' },
      }),
    ).toBe('gpt-4.1-mini');

    expect(isSafeModelName('gpt-4.1-mini')).toBe(true);
    expect(isSafeModelName('')).toBe(false);
    expect(isSafeModelName('https://evil.example/model')).toBe(false);
    expect(isSafeModelName('model with spaces')).toBe(false);
  });

  it('keeps the extension autofill fallback to the optimization model', () => {
    const resolved = resolveAiModel('EXTENSION_AUTOFILL', {
      env: { RESUME_OPTIMIZATION_MODEL: 'shared-model' },
    });

    expect(resolved.model).toBe('shared-model');
    expect(resolved.source).toBe('FALLBACK_ENV');
  });

  it('reports every effective model and whether it was overridden', () => {
    const env = { APPLICATION_MATERIALS_MODEL: 'writing-model' };
    const registry = describeAiModelRegistry({ env });

    expect(registry).toHaveLength(AI_MODEL_TASKS.length);
    expect(isAiModelOverridden('APPLICATION_MATERIALS', { env })).toBe(true);
    expect(isAiModelOverridden('JOB_INGESTION', { env })).toBe(false);
  });
});

describe('deterministic generated-text quality', () => {
  const clean =
    'I built payment infrastructure used by three product teams. I reduced settlement failures by 42% and mentored two engineers through their first production launch.';

  it('passes clean text', () => {
    const report = assessGeneratedText(clean);
    expect(report.ok).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.wordCount).toBeGreaterThan(10);
  });

  it('flags empty output as an error', () => {
    const report = assessGeneratedText('   ');
    expect(report.ok).toBe(false);
    expect(report.issues[0].code).toBe('EMPTY');
  });

  it('flags bracket, brace and unfinished placeholders', () => {
    for (const text of [
      `Dear [Insert company name], ${clean}`,
      `Dear {{company}}, ${clean}`,
      `Dear {company}, ${clean}`,
      `${clean} TODO: add metrics`,
    ]) {
      const report = assessGeneratedText(text);
      expect(report.ok).toBe(false);
      expect(report.issues.some((issue) => issue.code === 'PLACEHOLDER')).toBe(true);
    }
  });

  it('flags corrupted characters', () => {
    const report = assessGeneratedText(`${clean}\uFFFD`);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'CORRUPT_TEXT')).toBe(true);
  });

  it('warns when the same sentence is repeated to pad length', () => {
    const repeated =
      'I have delivered reliable payment systems for growing product teams across Europe.';
    const report = assessGeneratedText(`${repeated} ${repeated} ${repeated}`);

    expect(report.ok).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'REPEATED_SENTENCE')).toBe(true);
  });

  it('warns on short text and errors on oversized text', () => {
    const short = assessGeneratedText('Thank you.', { minChars: 80 });
    expect(short.ok).toBe(true);
    expect(short.issues.some((issue) => issue.code === 'TOO_SHORT')).toBe(true);

    const long = assessGeneratedText('a'.repeat(120), { maxChars: 100 });
    expect(long.ok).toBe(false);
    expect(long.issues.some((issue) => issue.code === 'TOO_LONG')).toBe(true);
  });
});
