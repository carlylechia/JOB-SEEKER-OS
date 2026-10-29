'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  MessageSquareText,
  Mic,
  Play,
  RotateCcw,
  Sparkles,
  Square,
} from 'lucide-react';
import {
  PRACTICE_MODE_LABELS,
  QUESTION_CATEGORY_LABELS,
  RUBRIC_DIMENSION_LABELS,
  type PracticeMode,
  type QuestionCategory,
} from '@/lib/interview-prep/schema';
import type {
  Attempt,
  PackDetail,
  PracticeSession,
  Question,
  StoredFeedback,
} from './types';
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

function FeedbackView({ feedback }: { feedback: StoredFeedback }) {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-sunken/30 p-3">
      <div className="flex items-center gap-2">
        <MessageSquareText className="h-4 w-4 text-accent-text" aria-hidden />
        <h4 className="text-sm font-semibold">Feedback</h4>
      </div>

      <div className="space-y-2">
        {feedback.dimensions.map((dimension) => (
          <div key={dimension.dimension} className="rounded-lg border border-line bg-card p-2.5">
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

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <FeedbackBlock title="What worked" text={feedback.whatWorked} />
        <FeedbackBlock title="What to improve" text={feedback.needsImprovement} />
        <FeedbackBlock title="What was missing" text={feedback.missing} />
        <FeedbackBlock title="Structure suggestion" text={feedback.structureSuggestion} />
      </div>

      {feedback.revisedStructure ? (
        <div className="rounded-lg bg-card p-2.5 text-xs">
          <p className="font-medium">A stronger structure</p>
          <p className="muted mt-1 whitespace-pre-wrap">{feedback.revisedStructure}</p>
        </div>
      ) : null}

      {feedback.adaptiveFollowUp ? (
        <div className="rounded-lg border border-accent/25 bg-accent/[0.05] p-2.5 text-xs">
          <p className="font-medium">The interviewer might follow up with</p>
          <p className="mt-1">{feedback.adaptiveFollowUp.question}</p>
          <p className="muted mt-1">{feedback.adaptiveFollowUp.why}</p>
          {feedback.adaptiveFollowUp.whatToInclude.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-muted">
              {feedback.adaptiveFollowUp.whatToInclude.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {feedback.followUpPractice.length > 0 ? (
        <div className="text-xs">
          <p className="font-medium">Practise next</p>
          <ul className="mt-1 list-disc pl-4 text-muted">
            {feedback.followUpPractice.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {feedback.limitations ? (
        <p className="text-[11px] text-muted">Limits of this feedback: {feedback.limitations}</p>
      ) : null}
    </div>
  );
}

function FeedbackBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg bg-card p-2.5">
      <p className="font-medium">{title}</p>
      <p className="muted mt-1">{text}</p>
    </div>
  );
}

function QuestionCard({
  packId,
  question,
  detail,
  sessionId,
  onSaved,
  compact = false,
}: {
  packId: string;
  question: Question;
  detail: PackDetail;
  sessionId?: string | null;
  onSaved?: () => void;
  compact?: boolean;
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
      const res = await fetch(`/api/interview-prep/${packId}/questions/${question.id}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const json = (await res.json()) as { attempt: Attempt | null; attempts: Attempt[] };
      setAttempts(json.attempts ?? []);
      setDraft(json.attempt?.answer ?? '');
    } catch {
      setError('We could not load your previous attempts.');
    } finally {
      setLoading(false);
    }
  }, [packId, question.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveAnswer() {
    if (draft.trim().length < 5) {
      setError('Write a little more before saving. Even a bullet-point draft is useful.');
      return;
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
        return;
      }
      await load();
      onSaved?.();
    } catch {
      setError('Your answer could not be saved. Please try again.');
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
      await load();
      onSaved?.();
    } catch {
      setError('Feedback could not be generated. Please try again.');
    } finally {
      setFeedbackLoading(false);
    }
  }

  const latest = attempts[0] ?? null;
  const sourceRefs = question.sourceRefs ?? [];
  const commonPitfalls = question.commonPitfalls ?? [];
  const sourceLinks = detail.sources.filter((source) => sourceRefs.includes(source.id));

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
          <span className="text-xs text-muted">Question {question.ordinal + 1}</span>
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
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCoaching ? 'rotate-180' : ''}`} aria-hidden />
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
                    <p className="font-semibold">Structure only — replace the placeholders with your own facts</p>
                    <p className="muted mt-1 italic">{question.coaching.sampleWordingPlaceholder}</p>
                  </div>
                ) : null}
              </>
            ) : null}
            {question.strongAnswerShows ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">A strong answer shows</p>
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
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write your answer as you would say it. Bullet points are fine for a first pass. We evaluate your own words — we do not write the story for you."
            maxLength={4_000}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary text-sm" onClick={() => void saveAnswer()} disabled={saving || loading}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            {latest ? 'Save revision' : 'Save answer'}
          </button>
          {latest && !latest.feedback ? (
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => void requestFeedback(latest.id)}
              disabled={feedbackLoading}
            >
              {feedbackLoading ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" aria-hidden />
              )}
              Get AI feedback
            </button>
          ) : null}
          <span className="text-xs text-muted">
            Saving is free. Feedback uses one AI credit from your monthly allowance.
          </span>
        </div>

        {error ? <p className="text-xs text-danger-text">{error}</p> : null}

        {attempts.length > 0 ? (
          <div className="space-y-2 border-t border-line pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Attempt history</h4>
            {attempts.map((attempt) => (
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
                      disabled={feedbackLoading}
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

export function QuestionsTab({ detail, onChanged }: { detail: PackDetail; onChanged: () => Promise<void> }) {
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
  const selected = questions.find((question) => question.id === selectedId) ?? filtered[0] ?? questions[0] ?? null;

  if (questions.length === 0) {
    return (
      <EmptyState
        title="No questions yet"
        description="Generate or regenerate the pack to build a role-specific question bank."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <aside className="space-y-3 lg:col-span-4">
        <Card className="space-y-3">
          <SectionHeading title={`${questions.length} questions`} description="Prioritised from the job and your evidence." />
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
            <p className="muted rounded-xl border border-line p-4 text-sm">No questions match this filter.</p>
          ) : null}
        </div>
      </aside>

      <div className="lg:col-span-8">
        {selected ? (
          <QuestionCard
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
  );
}

type SessionDetail = {
  session: PracticeSession;
  attempts: Attempt[];
  questions: Question[];
};

export function MockTab({ detail, onChanged }: { detail: PackDetail; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<PracticeMode>('FULL');
  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [index, setIndex] = useState(0);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');

  const loadSession = useCallback(
    async (sessionId: string) => {
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
        const firstUnanswered = json.questions.findIndex(
          (question) => !json.attempts.some((attempt) => attempt.questionId === question.id),
        );
        setIndex(firstUnanswered === -1 ? 0 : firstUnanswered);
      } catch {
        setError('That practice session could not be loaded.');
      } finally {
        setLoadingSession(false);
      }
    },
    [detail.pack.id],
  );

  async function startSession() {
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

  async function completeSession() {
    if (!session) return;
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
      await loadSession(session.session.id);
      await onChanged();
    } catch {
      setError('The session could not be completed.');
    } finally {
      setCompleting(false);
    }
  }

  const current = session?.questions[index] ?? null;
  const history = detail.sessions;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <SectionHeading
          title="Mock interview"
          description="A persisted sequence of questions selected from this pack. You write your answers, optionally request feedback, and complete the run. There is no timer pressure unless you create it."
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted" htmlFor="mock-mode">
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
          </div>
          <button type="button" className="btn-primary text-sm" onClick={() => void startSession()} disabled={starting}>
            {starting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="mr-1 h-4 w-4" aria-hidden />
            )}
            Start session
          </button>
        </div>
        <p className="text-xs text-muted">
          Starting a session is free. Each feedback request uses one AI credit. Starting a new session closes
          any active one for this pack.
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
                {session.session.status === 'ACTIVE' ? (
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
                onClick={() => setIndex((currentIndex) => Math.max(0, currentIndex - 1))}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden />
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={index >= session.questions.length - 1}
                onClick={() => setIndex((currentIndex) => Math.min(session.questions.length - 1, currentIndex + 1))}
              >
                Next
                <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </button>
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
              compact
              onSaved={async () => {
                await loadSession(session.session.id);
                await onChanged();
              }}
            />
          ) : (
            <EmptyState title="This session has no questions" description="Start a new session to practise." />
          )}
        </div>
      ) : null}

      {!session && !loadingSession ? (
        <EmptyState
          title="No session open"
          description="Choose a focus and start a mock interview. Your answers and feedback are saved against the pack."
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
          {summary.questionsAttempted} attempted · {summary.questionsWithFeedback} with feedback
        </p>
      </div>
      <div className="space-y-1">
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
        <div className="sm:col-span-2 flex flex-wrap gap-1">
          {summary.dimensions.map((dimension) => (
            <Pill key={dimension.dimension} tone="neutral">
              {RUBRIC_DIMENSION_LABELS[dimension.dimension]} · {dimension.rating.replaceAll('_', ' ').toLowerCase()} ×{dimension.count}
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
      <p className="text-xs text-muted">
        <RotateCcw className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        Reusable across sessions
      </p>
    </Card>
  );
}
