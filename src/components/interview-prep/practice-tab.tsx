'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Lightbulb,
  Loader2,
  Mic,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Square,
  TrendingUp,
} from 'lucide-react';
import {
  PRACTICE_MODE_LABELS,
  QUESTION_CATEGORY_LABELS,
  RUBRIC_DIMENSION_LABELS,
  type PracticeMode,
  type QuestionCategory,
} from '@/lib/interview-prep/schema';
import { defaultPracticeModeForContext } from '@/lib/interview-prep/plan';
import type {
  Attempt,
  PackDetail,
  PracticeSession,
  Question,
  StoredFeedback,
} from './types';
import { InterviewTypeBadge, InterviewTypeSummary } from './interview-type-picker';
import { Card, EmptyState, Pill, PriorityPill, SectionHeading } from './ui';

const MODES = Object.keys(PRACTICE_MODE_LABELS) as PracticeMode[];

const RATING_TONE: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  EVIDENT: 'success',
  PARTIAL: 'warn',
  NOT_EVIDENT: 'danger',
  INSUFFICIENT_EVIDENCE: 'neutral',
};

type ApiError = { error?: { message?: string } };

async function readError(res: Response): Promise<string> {
  const json = (await res.json().catch(() => ({}))) as ApiError;
  return json.error?.message ?? 'Something went wrong. Please try again.';
}

/** A complete evaluation is what unlocks the next mock question. */
function hasCompleteEvaluation(feedback: StoredFeedback | null | undefined): boolean {
  return Boolean(
    feedback &&
      typeof feedback.score === 'number' &&
      feedback.scoreRationale &&
      feedback.modelAnswer,
  );
}

function scoreTone(score: number): 'success' | 'info' | 'warn' | 'danger' {
  if (score >= 8) return 'success';
  if (score >= 6) return 'info';
  if (score >= 4) return 'warn';
  return 'danger';
}

function scoreVerdict(score: number): string {
  if (score >= 9) return 'Exceptional answer';
  if (score >= 7) return 'Strong answer';
  if (score >= 5) return 'Competent, but could go deeper';
  if (score >= 3) return 'Partial answer';
  return 'Off-track or incomplete';
}

function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2_000);
  }

  return (
    <button type="button" className="btn-secondary text-xs" onClick={() => void copy()}>
      {state === 'copied' ? (
        <Check className="mr-1 inline h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="mr-1 inline h-3.5 w-3.5" aria-hidden />
      )}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

function FeedbackBlock({
  title,
  text,
  tone = 'neutral',
}: {
  title: string;
  text: string;
  tone?: 'success' | 'warn' | 'neutral';
}) {
  const styles =
    tone === 'success'
      ? 'border-success/25 bg-success/[0.05]'
      : tone === 'warn'
        ? 'border-warn/25 bg-warn/[0.05]'
        : 'border-line bg-card';
  return (
    <div className={`rounded-xl border p-3 ${styles}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{text}</p>
    </div>
  );
}

function FeedbackView({
  feedback,
  onContinue,
  continueLabel = 'Save evaluation & continue',
  stale = false,
}: {
  feedback: StoredFeedback;
  onContinue?: () => void;
  continueLabel?: string;
  stale?: boolean;
}) {
  const score = feedback.score;
  const complete = hasCompleteEvaluation(feedback);
  const tone = score != null ? scoreTone(score) : 'neutral';
  const toneStyles: Record<string, string> = {
    success: 'border-success/30 bg-success/[0.07] text-success-text',
    info: 'border-[rgb(var(--info-text)/0.3)] bg-[rgb(var(--info-text)/0.07)] text-info-text',
    warn: 'border-warn/30 bg-warn/[0.07] text-warn-text',
    danger: 'border-danger/30 bg-danger/[0.07] text-danger-text',
    neutral: 'border-line bg-surface-sunken text-muted',
  };

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface-sunken/25 p-3 sm:p-4">
      <div className={`rounded-xl border p-3 sm:p-4 ${toneStyles[tone]}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">AI evaluation</p>
            <p className="mt-1 text-sm font-semibold text-ink">
              {score != null ? scoreVerdict(score) : 'This evaluation predates scoring'}
            </p>
            {score == null ? (
              <p className="mt-1 text-xs text-muted">
                Generate a new evaluation to get a score, score rationale and a standard answer.
              </p>
            ) : null}
          </div>
          <div className="flex items-baseline gap-1 rounded-xl bg-card/80 px-3 py-2 shadow-soft">
            <span className="text-3xl font-semibold tabular-nums text-ink">{score ?? '—'}</span>
            <span className="text-sm font-medium text-muted">/10</span>
          </div>
        </div>
        {feedback.scoreRationale ? (
          <p className="mt-3 text-sm leading-6 text-ink">{feedback.scoreRationale}</p>
        ) : null}
      </div>

      {stale ? (
        <p className="rounded-lg border border-warn/25 bg-warn/[0.06] p-2.5 text-xs text-ink">
          <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-warn-text" aria-hidden />
          This evaluation belongs to your previously saved answer. Save and evaluate the revision to replace
          it.
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <FeedbackBlock title="What worked" text={feedback.whatWorked} tone="success" />
        <FeedbackBlock title="What to improve" text={feedback.needsImprovement} tone="warn" />
      </div>

      <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Lightbulb className="h-4 w-4 text-accent-text" aria-hidden />
            Standard answer
          </h4>
          {feedback.modelAnswer ? <CopyButton value={feedback.modelAnswer} /> : null}
        </div>
        {feedback.modelAnswer ? (
          <>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{feedback.modelAnswer}</p>
            <p className="mt-2 text-[11px] text-muted">
              Replace anything in [square brackets] with your own verified facts. Never invent an employer,
              metric or outcome.
            </p>
          </>
        ) : (
          <p className="muted mt-2 text-sm">
            This older evaluation did not include a standard answer. Generate a scored evaluation to see one.
          </p>
        )}
      </div>

      {feedback.missing || feedback.structureSuggestion || feedback.revisedStructure ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {feedback.missing ? <FeedbackBlock title="What was missing" text={feedback.missing} /> : null}
          {feedback.structureSuggestion ? (
            <FeedbackBlock title="Structure suggestion" text={feedback.structureSuggestion} />
          ) : null}
          {feedback.revisedStructure ? (
            <div className="rounded-xl border border-line bg-card p-3 sm:col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                A stronger structure
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">
                {feedback.revisedStructure}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="rounded-xl border border-line bg-card p-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
          Rubric detail · {feedback.dimensions.length} dimension
          {feedback.dimensions.length === 1 ? '' : 's'}
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {feedback.dimensions.map((dimension) => (
            <div key={dimension.dimension} className="rounded-lg border border-line bg-surface-sunken/40 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium">{RUBRIC_DIMENSION_LABELS[dimension.dimension]}</p>
                <Pill tone={RATING_TONE[dimension.rating] ?? 'neutral'}>
                  {dimension.rating.replaceAll('_', ' ').toLowerCase()}
                </Pill>
              </div>
              <p className="muted mt-1 text-xs">{dimension.note}</p>
              {dimension.evidenceQuote ? (
                <p className="mt-1 border-l-2 border-accent/40 pl-2 text-xs italic text-muted">
                  “{dimension.evidenceQuote}”
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </details>

      {feedback.adaptiveFollowUp ? (
        <div className="rounded-xl border border-accent/25 bg-accent/[0.04] p-3 text-xs">
          <p className="font-semibold">The interviewer might follow up with</p>
          <p className="mt-1 text-sm">{feedback.adaptiveFollowUp.question}</p>
          <p className="muted mt-1">{feedback.adaptiveFollowUp.why}</p>
          {feedback.adaptiveFollowUp.whatToInclude.length > 0 ? (
            <ul className="muted mt-1 list-disc pl-4">
              {feedback.adaptiveFollowUp.whatToInclude.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {feedback.followUpPractice.length > 0 ? (
        <div className="text-xs">
          <p className="font-semibold">Practise next</p>
          <ul className="muted mt-1 list-disc pl-4">
            {feedback.followUpPractice.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {feedback.limitations ? (
        <p className="text-[11px] text-muted">Limits of this feedback: {feedback.limitations}</p>
      ) : null}

      {onContinue ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={onContinue}
            disabled={!complete || stale}
          >
            <CheckCircle2 className="mr-1 inline h-4 w-4" aria-hidden />
            {continueLabel}
          </button>
          <span className="text-xs text-muted">
            Your evaluation is already saved. Continuing moves this session forward.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function QuestionCard({
  packId,
  question,
  detail,
  sessionId,
  mock = false,
  onSaved,
  onContinue,
  continueLabel,
  onSkip,
  onDirtyChange,
  positionLabel,
}: {
  packId: string;
  question: Question;
  detail: PackDetail;
  sessionId?: string | null;
  mock?: boolean;
  onSaved?: () => void | Promise<void>;
  onContinue?: () => void;
  continueLabel?: string;
  onSkip?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  positionLabel?: string;
}) {
  const [draft, setDraft] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCoaching, setShowCoaching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      const res = await fetch(
        `/api/interview-prep/${packId}/questions/${question.id}${query}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const json = (await res.json()) as { attempt: Attempt | null; attempts: Attempt[] };
      const loaded = [...(json.attempts ?? [])].sort((a, b) => b.attemptNumber - a.attemptNumber);
      setAttempts(loaded);
      setDraft(loaded[0]?.answer ?? '');
    } catch {
      setError('We could not load your previous attempts.');
    } finally {
      setLoading(false);
    }
  }, [packId, question.id, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = attempts[0] ?? null;
  const trimmedDraft = draft.trim();
  const dirty = latest ? trimmedDraft !== latest.answer.trim() : trimmedDraft.length > 0;
  const busy = saving || feedbackLoading;
  const completeEvaluation = hasCompleteEvaluation(latest?.feedback);
  const evaluationReady = Boolean(latest && completeEvaluation && !dirty);
  const legacyEvaluation = Boolean(latest?.feedback && !completeEvaluation);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function replaceAttempt(attempt: Attempt) {
    setAttempts((current) =>
      [attempt, ...current.filter((item) => item.id !== attempt.id)].sort(
        (a, b) => b.attemptNumber - a.attemptNumber,
      ),
    );
    setDraft(attempt.answer);
  }

  function updateAttemptInPlace(attempt: Attempt) {
    setAttempts((current) =>
      current
        .map((item) => (item.id === attempt.id ? attempt : item))
        .sort((a, b) => b.attemptNumber - a.attemptNumber),
    );
  }

  async function saveAnswer(): Promise<Attempt | null> {
    if (trimmedDraft.length < 5) {
      setError('Write a little more before saving. Even a bullet-point draft is useful.');
      return null;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/interview-prep/${packId}/questions/${question.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: draft,
          sessionId: sessionId ?? null,
          kind: attempts.length > 0 ? 'REVISION' : 'INITIAL',
        }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return null;
      }
      const json = (await res.json()) as { attempt: Attempt };
      replaceAttempt(json.attempt);
      await onSaved?.();
      return json.attempt;
    } catch {
      setError('Your answer could not be saved. Please try again.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function requestFeedback(attemptId: string) {
    setFeedbackLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/interview-prep/${packId}/attempts/${attemptId}/feedback`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const json = (await res.json()) as { attempt: Attempt; creditsConsumed?: number };
      updateAttemptInPlace(json.attempt);
      await onSaved?.();
    } catch {
      setError('Feedback could not be generated. Please try again.');
    } finally {
      setFeedbackLoading(false);
    }
  }

  async function evaluateAnswer() {
    setError('');
    let target = latest;
    if (!target || trimmedDraft !== target.answer.trim()) {
      const saved = await saveAnswer();
      if (!saved) return;
      target = saved;
    }
    await requestFeedback(target.id);
  }

  function discardChanges() {
    setDraft(latest?.answer ?? '');
    setError('');
  }

  async function skipEvaluation() {
    const confirmed = window.confirm(
      'Skip the AI evaluation for this answer? Your answer will be saved, but you will not get a score or a standard answer, and the session will move on. You can return to this question later to evaluate it.',
    );
    if (!confirmed) return;
    // Saving is free, so never discard written work just because the candidate
    // does not want to spend a credit on evaluation.
    if (trimmedDraft.length >= 5 && (!latest || trimmedDraft !== latest.answer.trim())) {
      const saved = await saveAnswer();
      if (!saved) return;
    }
    onSkip?.();
  }

  const sourceRefs = question.sourceRefs ?? [];
  const commonPitfalls = question.commonPitfalls ?? [];
  const sourceLinks = detail.sources.filter((source) => sourceRefs.includes(source.id));
  const earlierAttempts = attempts.slice(1);
  const evaluateLabel =
    legacyEvaluation && !dirty
      ? 'Generate scored evaluation'
      : !latest || dirty
        ? 'Save & evaluate with AI'
        : 'Evaluate answer with AI';

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <Pill tone="accent">{QUESTION_CATEGORY_LABELS[question.category]}</Pill>
            <Pill tone="neutral">{question.difficulty.toLowerCase()}</Pill>
            <PriorityPill priority={question.priority} />
            {question.isPrediction ? <Pill tone="neutral">Predicted question</Pill> : null}
          </div>
          <span className="text-xs text-muted">
            {positionLabel ?? `Question ${question.ordinal + 1}`}
          </span>
        </div>

        <p className="text-base font-medium leading-6 text-ink">{question.question}</p>
        {question.whyMatters ? <p className="muted text-sm">{question.whyMatters}</p> : null}
        <div className="text-xs text-muted">
          <span className="font-medium">Competency: </span>
          {question.competency}
        </div>

        {question.relatedRequirement ? (
          <div className="rounded-lg bg-surface-sunken p-2.5 text-xs">
            <span className="font-medium">Requirement it tests: </span>
            {question.relatedRequirement}
          </div>
        ) : null}

        {question.relevantExperience ? (
          <div className="rounded-lg bg-success/[0.06] p-2.5 text-xs">
            <span className="font-medium">Your relevant evidence: </span>
            {question.relevantExperience}
          </div>
        ) : null}

        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-accent-text"
          onClick={() => setShowCoaching((current) => !current)}
          aria-expanded={showCoaching}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showCoaching ? 'rotate-180' : ''}`}
            aria-hidden
          />
          {showCoaching ? 'Hide coaching' : 'Show coaching and answer guidance'}
        </button>

        {showCoaching ? (
          <div className="space-y-3 rounded-xl border border-line p-3 text-sm">
            {question.coaching ? (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">What is assessed</p>
                  <p className="mt-1">{question.coaching.whatInterviewerAssesses}</p>
                </div>
                {question.coaching.keyPoints.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Key points</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                      {question.coaching.keyPoints.map((point, index) => (
                        <li key={`${point}-${index}`}>{point}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Practice exercise</p>
                  <p className="mt-1">{question.coaching.practiceExercise}</p>
                </div>
                {question.coaching.sampleWordingPlaceholder ? (
                  <div className="rounded-lg bg-surface-sunken p-2.5 text-xs">
                    <p className="font-semibold">
                      Structure only — replace the placeholders with your own facts
                    </p>
                    <p className="muted mt-1 italic">{question.coaching.sampleWordingPlaceholder}</p>
                  </div>
                ) : null}
              </>
            ) : null}
            {question.strongAnswerShows ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  A strong answer shows
                </p>
                <p className="mt-1">{question.strongAnswerShows}</p>
              </div>
            ) : null}
            {commonPitfalls.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Common pitfalls</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {commonPitfalls.map((pitfall, index) => (
                    <li key={`${pitfall}-${index}`}>{pitfall}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {question.prepNotes ? <p className="muted text-xs">{question.prepNotes}</p> : null}
          </div>
        ) : null}

        {sourceLinks.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {sourceLinks.map((source) => (
              <a
                key={source.id}
                className="badge bg-surface-sunken text-muted hover:text-ink"
                href={source.url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                title={source.title}
              >
                {source.title}
              </a>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{latest ? 'Revise your answer' : 'Your answer'}</h3>
          {latest ? <span className="text-xs text-muted">Attempt {latest.attemptNumber}</span> : null}
        </div>

        {loading ? (
          <p className="muted text-sm">Loading previous attempts…</p>
        ) : (
          <textarea
            className="input min-h-[180px]"
            value={draft}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              onDirtyChange?.(
                latest ? next.trim() !== latest.answer.trim() : next.trim().length > 0,
              );
            }}
            placeholder="Write your answer as you would say it. Bullet points are fine for a first pass. We evaluate your own words — we do not write the story for you."
            maxLength={4_000}
            disabled={busy}
          />
        )}

        {dirty && latest?.feedback ? (
          <p className="rounded-lg border border-warn/25 bg-warn/[0.06] p-2.5 text-xs text-ink">
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-warn-text" aria-hidden />
            You have edited your answer since the last evaluation. Save and evaluate the revision to update
            your score, or discard the edit to keep the existing evaluation.
          </p>
        ) : null}

        {!evaluationReady ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => void evaluateAnswer()}
              disabled={busy || loading || trimmedDraft.length < 5}
            >
              {busy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" aria-hidden />
              )}
              {feedbackLoading ? 'Evaluating…' : saving ? 'Saving…' : evaluateLabel}
            </button>
            {!latest || dirty ? (
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => void saveAnswer()}
                disabled={busy || loading || trimmedDraft.length < 5}
              >
                Save without evaluating
              </button>
            ) : null}
            {dirty && latest ? (
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={discardChanges}
                disabled={busy}
              >
                <RotateCcw className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                Discard edit
              </button>
            ) : null}
            {mock && onSkip ? (
              <button
                type="button"
                className="text-xs font-medium text-muted underline decoration-line underline-offset-2 hover:text-danger-text"
                onClick={skipEvaluation}
                disabled={busy}
              >
                Skip without evaluation
              </button>
            ) : null}
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-success-text">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Evaluation saved. Review the standard answer before continuing.
          </p>
        )}

        <p className="text-xs text-muted">
          Saving is free. A new AI evaluation uses one credit from your monthly allowance. Opening or re-reading
          an existing evaluation is free.
        </p>

        {error ? <p className="text-xs text-danger-text">{error}</p> : null}

        {latest?.feedback ? (
          <FeedbackView
            feedback={latest.feedback}
            onContinue={evaluationReady ? onContinue : undefined}
            continueLabel={continueLabel}
            stale={dirty}
          />
        ) : null}

        {earlierAttempts.length > 0 ? (
          <div className="space-y-2 border-t border-line pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Previous attempts</h4>
            {earlierAttempts.map((attempt) => (
              <details key={attempt.id} className="rounded-xl border border-line">
                <summary className="cursor-pointer px-3 py-2 text-xs">
                  Attempt {attempt.attemptNumber} · {new Date(attempt.createdAt).toLocaleString()} ·{' '}
                  {attempt.feedback ? 'feedback available' : 'no feedback yet'}
                </summary>
                <div className="space-y-2 border-t border-line px-3 py-3">
                  <p className="whitespace-pre-wrap text-sm">{attempt.answer}</p>
                  {!attempt.feedback ? (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => void requestFeedback(attempt.id)}
                      disabled={busy}
                    >
                      Generate feedback for this attempt
                    </button>
                  ) : (
                    <FeedbackView feedback={attempt.feedback} />
                  )}
                </div>
              </details>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export function QuestionsTab({
  detail,
  onChanged,
}: {
  detail: PackDetail;
  onChanged: () => Promise<void>;
}) {
  const questions = detail.data.questions;
  const [selectedId, setSelectedId] = useState<string | null>(questions[0]?.id ?? null);
  const [category, setCategory] = useState<'ALL' | QuestionCategory>('ALL');
  const [practisedOnly, setPractisedOnly] = useState(false);
  const attemptedIds = useMemo(
    () => new Set(detail.practicedQuestionIds ?? []),
    [detail.practicedQuestionIds],
  );

  useEffect(() => {
    if (!selectedId && questions[0]) setSelectedId(questions[0].id);
  }, [questions, selectedId]);

  const categories = Array.from(new Set(questions.map((question) => question.category))).sort();
  const filtered = questions.filter((question) => {
    if (category !== 'ALL' && question.category !== category) return false;
    if (practisedOnly && !attemptedIds.has(question.id)) return false;
    return true;
  });
  const selected =
    questions.find((question) => question.id === selectedId) ?? filtered[0] ?? questions[0] ?? null;

  if (questions.length === 0) {
    return (
      <EmptyState
        title="No questions yet"
        description="Generate or regenerate the pack to build a role-specific question bank."
      />
    );
  }

  return (
    <div className="space-y-4">
      <InterviewTypeSummary context={detail.data.context} />

      <div className="grid gap-4 lg:grid-cols-12">
        <aside className="space-y-3 lg:col-span-4">
          <Card className="space-y-3">
            <SectionHeading
              title={`${questions.length} questions`}
              description="Prioritised from the job, your evidence and this interview type."
              action={<InterviewTypeBadge context={detail.data.context} />}
            />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <select
                className="input text-sm"
                value={category}
                onChange={(event) => setCategory(event.target.value as 'ALL' | QuestionCategory)}
                aria-label="Filter by category"
              >
                <option value="ALL">All categories</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {QUESTION_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-line"
                  checked={practisedOnly}
                  onChange={(event) => setPractisedOnly(event.target.checked)}
                />
                Practised only
              </label>
            </div>
          </Card>

          <div className="space-y-2">
            {filtered.map((question) => {
              const active = selected?.id === question.id;
              return (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => setSelectedId(question.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    active ? 'border-accent bg-accent/[0.06]' : 'border-line bg-card hover:bg-surface-sunken'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                      Q{question.ordinal + 1} · {QUESTION_CATEGORY_LABELS[question.category]}
                    </span>
                    {attemptedIds.has(question.id) ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success-text" aria-label="Practised" />
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{question.question}</p>
                  <div className="mt-2 flex gap-1">
                    <PriorityPill priority={question.priority} />
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <p className="muted rounded-xl border border-line p-4 text-sm">
                No questions match this filter.
              </p>
            ) : null}
          </div>
        </aside>

        <div className="lg:col-span-8">
          {selected ? (
            <QuestionCard
              key={selected.id}
              packId={detail.pack.id}
              question={selected}
              detail={detail}
              sessionId={null}
              onSaved={async () => {
                await onChanged();
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

type SessionDetail = {
  session: PracticeSession;
  attempts: Attempt[];
  questions: Question[];
};

export function MockTab({ detail, onChanged }: { detail: PackDetail; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<PracticeMode>(() =>
    defaultPracticeModeForContext(detail.data.context),
  );
  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [index, setIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');

  const loadSession = useCallback(
    async (sessionId: string, options: { keepIndex?: boolean } = {}) => {
      setLoadingSession(true);
      setError('');
      try {
        const res = await fetch(
          `/api/interview-prep/${detail.pack.id}/sessions/${sessionId}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          setError(await readError(res));
          return;
        }
        const json = (await res.json()) as SessionDetail;
        setSession(json);
        setIndex((currentIndex) => {
          if (options.keepIndex) {
            return Math.max(0, Math.min(currentIndex, json.questions.length - 1));
          }
          // Resume at the first question that has not been fully evaluated.
          // A saved draft alone is not enough: the mock's review gate must not
          // be bypassed by a page reload or by reopening the session.
          const latestByQuestion = new Map<string, Attempt>();
          for (const attempt of json.attempts) {
            const current = latestByQuestion.get(attempt.questionId);
            if (!current || attempt.attemptNumber > current.attemptNumber) {
              latestByQuestion.set(attempt.questionId, attempt);
            }
          }
          const firstUnanswered = json.questions.findIndex((question) => {
            const latestAttempt = latestByQuestion.get(question.id);
            return !latestAttempt || !hasCompleteEvaluation(latestAttempt.feedback);
          });
          return firstUnanswered === -1 ? 0 : firstUnanswered;
        });
        if (!options.keepIndex) setDirty(false);
      } catch {
        setError('That practice session could not be loaded.');
      } finally {
        setLoadingSession(false);
      }
    },
    [detail.pack.id],
  );

  async function startSession() {
    if (
      dirty &&
      !window.confirm(
        'You have unsaved changes to this answer. Starting a new session will discard them. Continue?',
      )
    ) {
      return;
    }
    if (
      session?.session.status === 'ACTIVE' &&
      !window.confirm(
        'This will close the current active session and start a new one. Your saved answers and evaluations are kept. Continue?',
      )
    ) {
      return;
    }
    setStarting(true);
    setError('');
    try {
      const res = await fetch(`/api/interview-prep/${detail.pack.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const json = (await res.json()) as { session: PracticeSession };
      await loadSession(json.session.id);
      await onChanged();
    } catch {
      setError('The mock interview could not be started.');
    } finally {
      setStarting(false);
    }
  }

  async function completeSession(options: { skipDirtyCheck?: boolean } = {}) {
    if (!session) return;
    if (
      !options.skipDirtyCheck &&
      dirty &&
      !window.confirm('You have unsaved changes to this answer. Finishing the session will discard them. Continue?')
    ) {
      return;
    }
    setCompleting(true);
    setError('');
    try {
      const res = await fetch(
        `/api/interview-prep/${detail.pack.id}/sessions/${session.session.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'complete' }),
        },
      );
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      await loadSession(session.session.id, { keepIndex: true });
      setDirty(false);
      await onChanged();
    } catch {
      setError('The session could not be completed.');
    } finally {
      setCompleting(false);
    }
  }

  function advance() {
    if (!session) return;
    setDirty(false);
    if (index >= session.questions.length - 1) {
      void completeSession({ skipDirtyCheck: true });
      return;
    }
    setIndex((currentIndex) => Math.min(session.questions.length - 1, currentIndex + 1));
  }

  function goPrevious() {
    if (dirty) {
      const confirmed = window.confirm(
        'You have unsaved changes to this answer. Going back will discard them. Continue?',
      );
      if (!confirmed) return;
    }
    setDirty(false);
    setIndex((currentIndex) => Math.max(0, currentIndex - 1));
  }

  function goNext() {
    if (!session) return;
    if (dirty) {
      const confirmed = window.confirm(
        'You have unsaved changes to this answer. Moving on will discard them. Continue?',
      );
      if (!confirmed) return;
    }
    setDirty(false);
    setIndex((currentIndex) => Math.min(session.questions.length - 1, currentIndex + 1));
  }

  async function refreshAfterSave() {
    if (!session) return;
    await loadSession(session.session.id, { keepIndex: true });
    await onChanged();
  }

  const current = session?.questions[index] ?? null;
  const history = detail.sessions;
  const recommendedMode = defaultPracticeModeForContext(detail.data.context);
  const active = session?.session.status === 'ACTIVE';

  return (
    <div className="space-y-4">
      <InterviewTypeSummary context={detail.data.context} />

      <Card className="space-y-3">
        <SectionHeading
          title="Mock interview"
          description="A persisted sequence of questions selected from this pack. Answer each question, review the AI score and standard answer, then confirm before moving on. You can still skip an evaluation, but the session will warn you first."
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
              htmlFor="mock-mode"
            >
              Session focus
            </label>
            <select
              id="mock-mode"
              className="input"
              value={mode}
              onChange={(event) => setMode(event.target.value as PracticeMode)}
            >
              {MODES.map((value) => (
                <option key={value} value={value}>
                  {PRACTICE_MODE_LABELS[value]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              Recommended for this pack: {PRACTICE_MODE_LABELS[recommendedMode]}.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => void startSession()}
            disabled={starting}
          >
            {starting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="mr-1 h-4 w-4" aria-hidden />
            )}
            Start session
          </button>
        </div>
        <p className="text-xs text-muted">
          Starting a session is free. Each AI evaluation uses one credit. Starting a new session closes any
          active one for this pack.
        </p>
        {error ? <p className="text-xs text-danger-text">{error}</p> : null}
      </Card>

      {history.length > 0 ? (
        <Card className="space-y-2">
          <h3 className="text-sm font-semibold">Previous sessions</h3>
          <div className="space-y-2">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void loadSession(item.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-left text-sm hover:bg-surface-sunken"
              >
                <span>
                  {PRACTICE_MODE_LABELS[item.mode]} · {new Date(item.startedAt).toLocaleString()}
                  {item.summary?.averageScore !== null && item.summary?.averageScore !== undefined
                    ? ` · avg ${item.summary.averageScore}/10`
                    : ''}
                </span>
                <Pill tone={item.status === 'COMPLETED' ? 'success' : 'warn'}>
                  {item.status.toLowerCase()}
                </Pill>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {loadingSession ? (
        <Card>
          <p className="muted text-sm">Loading session…</p>
        </Card>
      ) : null}

      {session ? (
        <div className="space-y-4">
          <Card className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {PRACTICE_MODE_LABELS[session.session.mode]}
                </p>
                <h3 className="text-sm font-semibold">
                  Question {Math.min(index + 1, session.questions.length)} of {session.questions.length}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={session.session.status === 'COMPLETED' ? 'success' : 'warn'}>
                  {session.session.status.toLowerCase()}
                </Pill>
                {active ? (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => void completeSession()}
                    disabled={completing}
                  >
                    {completing ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Square className="mr-1 h-3.5 w-3.5" aria-hidden />
                    )}
                    Finish session
                  </button>
                ) : null}
              </div>
            </div>

            {session.session.status === 'COMPLETED' && session.session.summary ? (
              <SessionSummary summary={session.session.summary} />
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={index <= 0}
                onClick={goPrevious}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden />
                Previous
              </button>
              {!active ? (
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={index >= session.questions.length - 1}
                  onClick={goNext}
                >
                  Next
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </button>
              ) : (
                <span className="text-xs text-muted">
                  Evaluate this answer, then use “Save evaluation &amp; continue” below.
                </span>
              )}
              <span className="text-xs text-muted">
                <Clock className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                {session.attempts.filter((attempt) => attempt.sessionId === session.session.id).length} saved
                answer(s) in this session
              </span>
            </div>
          </Card>

          {current ? (
            <QuestionCard
              key={`${session.session.id}:${current.id}`}
              packId={detail.pack.id}
              question={current}
              detail={detail}
              sessionId={session.session.id}
              mock
              positionLabel={`Question ${Math.min(index + 1, session.questions.length)} of ${session.questions.length}`}
              onSaved={refreshAfterSave}
              onContinue={active ? advance : undefined}
              continueLabel={
                index >= session.questions.length - 1
                  ? 'Save evaluation & finish'
                  : 'Save evaluation & continue'
              }
              onSkip={active ? advance : undefined}
              onDirtyChange={setDirty}
            />
          ) : (
            <EmptyState title="This session has no questions" description="Start a new session to practise." />
          )}
        </div>
      ) : null}

      {!session && !loadingSession ? (
        <EmptyState
          title="No session open"
          description="Choose a focus and start a mock interview. Your answers and evaluations are saved against the pack."
        />
      ) : null}
    </div>
  );
}

function SessionSummary({ summary }: { summary: NonNullable<PracticeSession['summary']> }) {
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-surface-sunken/40 p-3 text-xs sm:grid-cols-2">
      <div>
        <p className="font-medium">Session summary</p>
        <p className="muted mt-1">{summary.note}</p>
        <p className="muted mt-1">
          {summary.questionsAttempted} attempted · {summary.questionsWithFeedback} with feedback ·{' '}
          {summary.scoredAttempts} scored
        </p>
      </div>
      <div className="space-y-1">
        {summary.averageScore != null ? (
          <p className="flex items-center gap-1 text-sm font-semibold text-ink">
            <TrendingUp className="h-3.5 w-3.5 text-accent-text" aria-hidden />
            Average score: {summary.averageScore}/10
          </p>
        ) : (
          <p className="muted">No scored evaluations in this session yet.</p>
        )}
        {summary.strengths.length > 0 ? (
          <p>
            <span className="font-medium">Strengths: </span>
            {summary.strengths.join(' · ')}
          </p>
        ) : null}
        {summary.priorities.length > 0 ? (
          <p>
            <span className="font-medium">Priorities: </span>
            {summary.priorities.join(' · ')}
          </p>
        ) : null}
      </div>
      {summary.dimensions.length > 0 ? (
        <div className="flex flex-wrap gap-1 sm:col-span-2">
          {summary.dimensions.map((dimension) => (
            <Pill key={dimension.dimension} tone="neutral">
              {RUBRIC_DIMENSION_LABELS[dimension.dimension]} ·{' '}
              {dimension.rating.replaceAll('_', ' ').toLowerCase()} ×{dimension.count}
            </Pill>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PracticeOverview({ detail }: { detail: PackDetail }) {
  const attempts = useMemo(() => detail.pack.practicedCount, [detail.pack.practicedCount]);
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent-text">
          <Mic className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold">Practice evidence</p>
          <p className="muted text-xs">
            {attempts}/{detail.pack.questionCount} questions attempted · {detail.pack.feedbackCount} with
            feedback
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <InterviewTypeBadge context={detail.data.context} />
        <p className="text-xs text-muted">
          <RotateCcw className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Reusable across sessions
        </p>
      </div>
    </Card>
  );
}
