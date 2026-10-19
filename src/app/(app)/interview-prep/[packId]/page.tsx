/**
 * Interview preparation pack workspace.
 *
 * One page per pack: overview, the question set, and text-based practice.
 * Reads are server-side where possible and client-side interactivity is used
 * only for answer submission, feedback and progress. A refresh never erases
 * saved answers — attempts are persisted server-side and reloaded on return.
 */

'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import {
  type AnswerStructure,
  type InterviewContext,
  INTERVIEW_CONTEXT_LABELS,
  INTERVIEW_CONTEXT_DESCRIPTIONS,
  QUESTION_CATEGORY_LABELS,
} from '@/lib/interview-prep/schema';
import { ANSWER_FRAMEWORK_GUIDANCE } from '@/lib/interview-prep/prompt';

type PackEnvelope = {
  available: boolean;
  reason?: string;
  pack: {
    id: string;
    jobId: string;
    title: string;
    context: string;
    status: string;
    questionCount: number;
    practicedCount: number;
    feedbackCount: number;
    lastPracticedAt: string | null;
    isFresh: boolean;
    createdAt: string;
    updatedAt: string;
  };
  data: {
    id: string;
    questions: Array<{
      id: string;
      version: number;
      ordinal: number;
      category: string;
      difficulty: string;
      competency: string;
      question: string;
      whyMatters: string;
      relatedRequirement: string | null;
      relevantExperience: string | null;
      prepNotes: string | null;
      answerStructure: AnswerStructure | null;
      followUpQuestionIds: string[];
      sourceType: string;
      sourceEvidence: string | null;
      isActive: boolean;
    }>;
    preparationGuidance: string | null;
    limitations: string[];
  };
  isFresh: boolean;
};

type QuestionRow = PackEnvelope['data']['questions'][number];

type Attempt = {
  id: string;
  attemptNumber: number;
  answer: string;
  feedback: string | null;
  createdAt: string;
};

type Feedback = {
  dimensions: Array<{
    dimension: string;
    rating: string;
    note: string;
    evidenceQuote: string | null;
  }>;
  whatWorked: string;
  needsImprovement: string;
  missing: string;
  structureSuggestion: string;
  followUpPractice: string[];
  limitations: string | null;
};

async function apiPostJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export default function InterviewPrepPackPage() {
  const params = useParams<{ packId: string }>();
  const packId = params.packId;

  const [envelope, setEnvelope] = useState<PackEnvelope | null>(null);
  const [error, setError] = useState('');
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [feedbackByAttempt, setFeedbackByAttempt] = useState<Record<string, Feedback>>({});
  const [attemptByQuestion, setAttemptByQuestion] = useState<Record<string, Attempt>>({});

  const runningRef = useRef(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/interview-prep/${packId}`, { cache: 'no-store' });
      if (res.status === 404) {
        notFound();
        return;
      }
      if (!res.ok) throw new Error('Could not load the preparation pack.');
      const json = (await res.json()) as PackEnvelope;
      setEnvelope(json);
      if (json.data.questions.length > 0 && !activeQuestionId) {
        setActiveQuestionId(json.data.questions[0].id);
      }
    } catch {
      setError('We could not load the preparation pack. Please try again.');
    }
  }, [packId, activeQuestionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load the latest attempt for the active question so a returning user sees
  // their previous answer and feedback without regenerating anything.
  useEffect(() => {
    if (!activeQuestionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/interview-prep/${packId}/questions/${activeQuestionId}`,
          { cache: 'no-store' },
        );
      if (res.ok) {
        const json = (await res.json()) as { question: QuestionRow; attempt: Attempt | null };
        if (!cancelled && json.attempt) {
          setAttemptByQuestion((prev: Record<string, Attempt>) => ({
            ...prev,
            [activeQuestionId]: json.attempt as Attempt,
          }));
          setDraft(json.attempt.answer);
        }
      }
      } catch {
        // Attempt loading is a nice-to-have; a failed read must not block practice.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packId, activeQuestionId]);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Preparation pack" subtitle="Job-specific interview questions and practice." />
        <div className="card-pad rounded-xl border border-danger/25 bg-danger/[0.05] p-4">
          <p className="text-sm text-ink">{error}</p>
        </div>
      </div>
    );
  }

  if (!envelope) {
    return (
      <div className="space-y-6">
        <PageHeader title="Preparation pack" subtitle="Job-specific interview questions and practice." />
        <div className="card-pad flex items-center gap-2 text-sm muted">
          <span className="animate-pulse">Loading pack…</span>
        </div>
      </div>
    );
  }

  if (!envelope.available) {
    notFound();
    return null;
  }

  const { pack } = envelope;
  const questions = envelope.data.questions;
  const limitations = envelope.data.limitations;
  const activeQuestion =
    questions.find((q) => q.id === activeQuestionId) ?? questions[0] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={pack.title}
        subtitle={pack.jobId ? `Job: ${pack.title}` : undefined}
        action={
          <div className="flex items-center gap-2">
            {!envelope.isFresh && (
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => void refreshPack()}
                disabled={submitting}
              >
                Refresh pack
              </button>
            )}
            <Link
              href={`/jobs/${pack.jobId}`}
              className="btn-secondary text-xs"
              passHref
            >
              Back to job
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-12">
        {/* Sidebar: pack overview + question list */}
        <div className="md:col-span-4 space-y-4">
          <PackMeta pack={pack} envelope={envelope} />
          <QuestionList
            questions={questions}
            activeId={activeQuestionId ?? null}
            onSelect={setActiveQuestionId}
          />
        </div>

        {/* Main: current question + practice */}
        <div className="md:col-span-8 space-y-4">
          {activeQuestion ? (
            <QuestionView
              question={activeQuestion}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={handleSubmitAnswer}
              submitting={submitting}
              feedback={feedbackByAttempt[activeQuestionId ?? '']}
            />
          ) : (
            <div className="card-pad text-center py-12 text-muted">
              This pack has no questions yet. Refresh the pack to generate questions.
            </div>
          )}
        </div>
      </div>

      {limitations.length > 0 && (
        <div className="rounded-xl border border-warn/25 bg-warn/[0.05] p-4">
          <h3 className="text-sm font-semibold mb-2">What this pack could not cover</h3>
          <ul className="text-sm text-muted space-y-1">
            {limitations.map((limitation) => (
              <li key={limitation} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">⚠</span>
                {limitation}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  async function handleSubmitAnswer() {
    if (!activeQuestion) return;
    const trimmed = draft.replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    if (runningRef.current) return;
    runningRef.current = true;
    setSubmitting(true);
    try {
      const res = await apiPostJson(
        `/api/interview-prep/${packId}/questions/${activeQuestion.id}`,
        { answer: trimmed },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(json.error?.message ?? 'Could not save your answer.');
        return;
      }
      const json = (await res.json()) as { attempt: Attempt };
      setDraft('');
      // Start feedback generation for the new attempt.
      void handleGetFeedback(json.attempt.id);
    } finally {
      runningRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleGetFeedback(attemptId: string) {
    try {
      const res = await apiPostJson(
        `/api/interview-prep/${packId}/attempts/${attemptId}/feedback`,
        {},
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(json.error?.message ?? 'Could not generate feedback.');
        return;
      }
      const json = (await res.json()) as { feedback: Feedback };
      setFeedbackByAttempt((prev) => ({ ...prev, [attemptId]: json.feedback }));
      // Mark progress by reloading the pack so counts update.
      void load();
    } finally {}
  }

  async function refreshPack() {
    if (runningRef.current) return;
    runningRef.current = true;
    setSubmitting(true);
    try {
      const res = await apiPostJson(`/api/interview-prep/${packId}/regenerate`, {});
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(json.error?.message ?? 'Could not refresh the pack.');
        return;
      }
      const json = (await res.json()) as { pack: PackEnvelope['pack']; data: PackEnvelope['data'] };
      setEnvelope((prev) =>
        prev ? { ...prev, pack: json.pack, data: json.data, isFresh: true } : prev,
      );
      if (json.data.questions.length > 0) {
        setActiveQuestionId(json.data.questions[0].id);
        setDraft('');
        setFeedbackByAttempt({});
      }
    } finally {
      runningRef.current = false;
      setSubmitting(false);
    }
  }
}

function PackMeta({
  pack,
  envelope,
}: {
  pack: PackEnvelope['pack'];
  envelope: PackEnvelope;
}) {
  const contextLabel = INTERVIEW_CONTEXT_LABELS[
    pack.context as InterviewContext
  ];
  const contextDesc = INTERVIEW_CONTEXT_DESCRIPTIONS[
    pack.context as InterviewContext
  ];

  return (
    <div className="rounded-xl border border-line p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="muted text-xs uppercase tracking-widest">Status</p>
          <span className={`badge ${pack.status === 'ACTIVE' ? 'bg-success/15 text-success-text' : 'bg-surface-sunken text-ink'}`}>
            {pack.status === 'ACTIVE' ? 'Active' : 'Archived'}
          </span>
        </div>
      </div>
      <div>
        <p className="muted text-xs uppercase tracking-widest">Interview context</p>
        <p className="text-sm font-medium text-ink">{contextLabel}</p>
        <p className="mt-1 text-xs text-muted">{contextDesc}</p>
      </div>
      <div className="border-t border-line pt-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="muted">Questions</span>
          <span className="text-ink font-medium">{pack.questionCount}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="muted">Practiced</span>
          <span className="text-ink font-medium">{pack.practicedCount}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="muted">Feedback received</span>
          <span className="text-ink font-medium">{pack.feedbackCount}</span>
        </div>
        {pack.lastPracticedAt && (
          <div className="flex items-center justify-between text-xs muted">
            <span>Last practiced</span>
            <span>{new Date(pack.lastPracticedAt).toLocaleDateString()}</span>
          </div>
        )}
      </div>
      {!envelope.isFresh && (
        <p className="mt-2 text-xs text-warn-text">
          ⚠ The job, your profile or your resume has changed since this pack
          was generated. Refresh it for an up-to-date question set. Your
          previous answers are kept.
        </p>
      )}
    </div>
  );
}

function QuestionList({
  questions,
  activeId,
  onSelect,
}: {
  questions: QuestionRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-line p-4 space-y-2">
      <p className="muted text-xs uppercase tracking-widest mb-2">Questions</p>
      {questions.map((question) => {
        const isActive = question.id === activeId;
        const categoryLabel = QUESTION_CATEGORY_LABELS[
          question.category as keyof typeof QUESTION_CATEGORY_LABELS
        ];
        return (
          <button
            key={question.id}
            type="button"
            onClick={() => onSelect(question.id)}
            className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
              isActive
                ? 'border-[#8A6D1F] bg-[#F1D78A]/20'
                : 'border-transparent bg-transparent hover:bg-surface-sunken'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{question.question}</p>
              <p className="mt-1 text-xs text-muted">
                {categoryLabel} · {question.difficulty.charAt(0) +
                question.difficulty.slice(1).toLowerCase()}
              </p>
              {question.relevantExperience && (
                <p className="mt-1 text-xs text-success-text">
                  Related: {question.relevantExperience}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function QuestionView({
  question,
  draft,
  onDraftChange,
  onSubmit,
  submitting,
  feedback,
}: {
  question: QuestionRow;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  feedback: Feedback | undefined;
}) {
  const framework = question.answerStructure
    ? ANSWER_FRAMEWORK_GUIDANCE[question.answerStructure]
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="muted text-xs uppercase tracking-widest">
            {QUESTION_CATEGORY_LABELS[
              question.category as keyof typeof QUESTION_CATEGORY_LABELS
            ]}
          </p>
          <h2 className="text-lg font-semibold text-ink">{question.question}</h2>
          {question.relatedRequirement && (
            <p className="mt-1 text-xs text-muted">
              Targets: {question.relatedRequirement}
            </p>
          )}
        </div>
        {question.sourceType === 'EDITED' && (
          <span className="badge bg-surface-sunken text-ink text-xs">Edited</span>
        )}
      </div>

      {question.prepNotes && (
        <div className="rounded-xl border border-line bg-surface-sunken p-3">
          <p className="muted text-xs font-medium mb-1">Preparation notes</p>
          <p className="text-sm text-muted">{question.prepNotes}</p>
        </div>
      )}

      {framework && (
        <div className="rounded-xl border border-line p-3">
          <p className="muted text-xs font-medium mb-1">
            Suggested structure: {framework.name}
          </p>
          <ul className="text-sm text-muted space-y-1">
            {framework.steps.map((step: string) => (
              <li key={step} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-[#8A6D1F]">✦</span>
                {step}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{framework.hint}</p>
        </div>
      )}

      {question.relevantExperience && (
        <p className="text-xs text-muted">
          Suggested example: {question.relevantExperience}. This is drawn from
          your saved career profile — confirm it reflects your experience.
        </p>
      )}

      <div className="rounded-xl border border-line p-4">
        <p className="muted text-xs font-medium mb-2">Your answer</p>
        <textarea
          className="input w-full h-48"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Write your answer here. Drafts save when you submit."
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={onSubmit}
            disabled={submitting || !draft.replace(/\s+/g, ' ').trim()}
          >
            {submitting ? 'Saving…' : 'Submit & get feedback'}
          </button>
        </div>
      </div>

      {feedback && (
        <FeedbackView feedback={feedback} question={question} />
      )}
    </div>
  );
}

function FeedbackView({
  feedback,
  question,
}: {
  feedback: Feedback;
  question: QuestionRow;
}) {
  const dimensionStyles: Record<string, string> = {
    EVIDENT: 'bg-success/15 text-success-text',
    PARTIAL: 'bg-accent/20 text-accent-text',
    NOT_EVIDENT: 'bg-danger/15 text-danger-text',
    INSUFFICIENT_EVIDENCE: 'bg-surface-sunken text-muted',
  };

  return (
    <div className="rounded-xl border border-[#8A6D1F] bg-[#F1D78A]/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Feedback</h3>
        <p className="muted text-xs">Based on your submitted answer.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {feedback.dimensions.map((dimension, index) => (
          <div
            key={index}
            className="rounded-lg border border-line p-3"
          >
            <p className="text-xs font-medium text-muted">
              {dimension.dimension}
            </p>
            <div className="flex items-center gap-1 mt-1">
              <span
                className={`badge text-xs ${dimensionStyles[dimension.rating] ?? 'bg-surface-sunken text-ink'}`}
              >
                {dimension.rating}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">{dimension.note}</p>
            {dimension.evidenceQuote && (
              <p className="mt-1 text-xs italic text-muted">
                “{dimension.evidenceQuote}”
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {feedback.whatWorked && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-success-text">✓</span>
            <p className="text-sm text-ink">
              <span className="font-semibold">What worked:</span>{' '}
              {feedback.whatWorked}
            </p>
          </div>
        )}
        {feedback.needsImprovement && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-warn-text">⚠</span>
            <p className="text-sm text-ink">
              <span className="font-semibold">To improve:</span>{' '}
              {feedback.needsImprovement}
            </p>
          </div>
        )}
        {feedback.missing && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-muted">–</span>
            <p className="text-sm text-ink">
              <span className="font-semibold">May be missing:</span>{' '}
              {feedback.missing}
            </p>
          </div>
        )}
        {feedback.structureSuggestion && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-[#8A6D1F]">→</span>
            <p className="text-sm text-ink">
              <span className="font-semibold">Structure:</span>{' '}
              {feedback.structureSuggestion}
            </p>
          </div>
        )}
        {feedback.followUpPractice.length > 0 && (
          <div>
            <p className="muted text-xs font-medium mb-1">Follow-up practice</p>
            <ul className="text-sm text-muted space-y-1 list-disc list-inside">
              {feedback.followUpPractice.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {feedback.limitations && (
          <p className="mt-2 text-xs text-muted">
            ⚠ {feedback.limitations}
          </p>
        )}
      </div>
    </div>
  );
}
