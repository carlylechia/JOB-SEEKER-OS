'use client';

/**
 * Job-specific optimisation review.
 *
 * This screen is the product. Everything upstream exists to produce a list the
 * user can read and disagree with, so the interface is built around four rules:
 *
 *  1. NOTHING CHANGES WITHOUT A CLICK. The model returns proposals. This panel
 *     shows them. The document is untouched until Accept is pressed, and even
 *     then only for the accepted subset.
 *
 *  2. SHOW THE REASONING AND ITS LIMITS. Every operation carries why it helps,
 *     the posting requirement it addresses, the verbatim evidence behind it and
 *     a confidence level. Where the server refused an operation, the count and
 *     the reason are shown too — "we removed 2 suggestions because they
 *     introduced figures your resume does not support" is more trustworthy than
 *     silently returning a shorter list.
 *
 *  3. NO NEW CLAIMS, ENFORCED NOT PROMISED. Where a suggestion would need a
 *     number the user has not given, it arrives as a QUESTION in
 *     `informationGaps`, not as an edit.
 *
 *  4. STALE IS VISIBLE. If the resume or the job moved after the suggestions
 *     were made, the whole panel is marked and applying is refused until the
 *     user runs it again. Silently applying advice written for a different
 *     document is the failure this feature most needs to avoid.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  Loader,
  Pencil,
  RotateCw,
  Sparkles,
  X,
} from 'lucide-react';

import type { OptimizationResult, ReviewOperation } from '@/lib/resume-builder/optimization/schema';
import { AiCreditsMeter } from '@/components/billing/ai-credits-meter';
import type { AiCreditsPayload } from '@/lib/billing/ai-credits';

type Props = {
  resumeId: string;
  revision: number;
  targetJobId: string | null;
  canOptimize: boolean;
  onApplied: (next: { revision: number; content: unknown; layout: unknown }) => void;
};

type Wire = {
  available: boolean;
  job: {
    id: string;
    title: string;
    company: string;
    hasDescription: boolean;
    fitScore: number;
    fitTier: string;
    blockedBy: string[];
  } | null;
  readiness: {
    hasJobDescription: boolean;
    hasConfirmedProfile: boolean;
    resumeCharacters: number;
    thinInputs: boolean;
  } | null;
  optimization: {
    id: string;
    isFresh: boolean;
    staleReasons: string[];
    data: OptimizationResult;
  } | null;
  access: { canOptimize: boolean; plan: string; aiCredits: AiCreditsPayload };
  privacyNotice: string;
};

type Phase = 'loading' | 'idle' | 'running' | 'error';

const CONFIDENCE_STYLES: Record<ReviewOperation['confidence'], string> = {
  HIGH: 'bg-success/15 text-success-text',
  MEDIUM: 'bg-warn/15 text-warn-text',
  LOW: 'bg-muted/10 text-muted',
};

export function ResumeOptimizationPanel({
  resumeId,
  revision,
  targetJobId,
  canOptimize,
  onApplied,
}: Props) {
  const [state, setState] = useState<Wire | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editedText, setEditedText] = useState<Record<string, string>>({});
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [applying, setApplying] = useState(false);
  // A ref, not state: a double-click inside one render must not be able to fire
  // two provider calls, and a ref updates synchronously.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/resumes/${resumeId}/optimization`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('unavailable');
      const data = (await response.json()) as Wire;
      setState(data);
      setPhase('idle');
    } catch {
      setPhase('error');
      setMessage('We could not load your optimisation history.');
    }
  }, [resumeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase('running');
    setMessage('');
    try {
      const response = await fetch(`/api/resumes/${resumeId}/optimization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setPhase('error');
        setMessage(
          (payload?.error?.message as string | undefined) ??
            'Optimisation is unavailable right now. Please try again.',
        );
        await load();
        return;
      }

      setAccepted(new Set());
      setRejected(new Set());
      setEditedText({});
      setPhase('idle');
      await load();
    } catch {
      setPhase('error');
      setMessage('Something went wrong. Your resume was not changed.');
    } finally {
      inFlight.current = false;
    }
  }, [resumeId, load]);

  const apply = useCallback(async () => {
    const optimization = state?.optimization;
    if (!optimization) return;
    setApplying(true);
    setMessage('');
    try {
      const response = await fetch(`/api/resumes/${resumeId}/optimization/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          optimizationId: optimization.id,
          acceptedOperationIds: Array.from(accepted),
          editedText: Object.keys(editedText).length > 0 ? editedText : undefined,
          expectedRevision: revision,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setMessage(
          (payload?.error?.message as string | undefined) ??
            'Those changes could not be saved. Nothing was changed.',
        );
        await load();
        return;
      }

      const skipped = (payload?.skipped as Array<{ reason: string }> | undefined) ?? [];
      setMessage(
        skipped.length > 0
          ? `Saved ${payload.appliedCount} change${payload.appliedCount === 1 ? '' : 's'}. ${skipped.length} could not be applied.`
          : `Saved ${payload.appliedCount} change${payload.appliedCount === 1 ? '' : 's'}.`,
      );
      setAccepted(new Set());
      setRejected(new Set());
      setEditedText({});
      onApplied({
        revision: payload.resume.revision,
        content: payload.resume.content,
        layout: payload.layout,
      });
      await load();
    } catch {
      setMessage('Something went wrong. Your resume was not changed.');
    } finally {
      setApplying(false);
    }
  }, [state, resumeId, accepted, editedText, revision, onApplied, load]);

  if (phase === 'loading') {
    return (
      <section aria-labelledby="optimization-heading" className="card-pad">
        <h2 id="optimization-heading" className="text-base font-semibold text-ink">
          Optimise for a job
        </h2>
        <p className="muted mt-2 flex items-center gap-2">
          <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </p>
      </section>
    );
  }

  const result = state?.optimization?.data ?? null;
  const isStale = state?.optimization ? !state.optimization.isFresh : false;
  const operations = result?.operations ?? [];
  const visible = operations.filter((operation) => !rejected.has(operation.id));

  return (
    <section aria-labelledby="optimization-heading" className="card-pad space-y-4">
      <div>
        <h2 id="optimization-heading" className="text-base font-semibold text-ink">
          Optimise for a job
        </h2>
        <p className="mt-1 text-sm text-muted">
          Suggestions are drawn only from what is already in your resume and career profile. You decide
          what to keep.
        </p>
      </div>

      {!targetJobId ? (
        <p className="rounded-xl border border-line bg-surface p-3 text-sm text-ink-2">
          Choose a target job above first. Optimisation always works against one specific job — that is
          what makes the suggestions specific.
        </p>
      ) : null}

      {state?.readiness && !state.readiness.hasJobDescription ? (
        <p className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs text-warn-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          This job has no description saved, so the suggestions can only use the title and company. Add
          the posting for something useful.
        </p>
      ) : null}

      {!canOptimize ? (
        <p className="rounded-xl border border-line bg-surface p-3 text-sm text-ink-2">
          Optimisation is available on Pro. Everything else about this resume keeps working exactly as
          it does.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!targetJobId || !canOptimize || phase === 'running'}
          onClick={() => void run()}
        >
          {phase === 'running' ? (
            <Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          {result ? 'Run again' : 'Optimise for this job'}
        </button>

        <button
          type="button"
          className="btn-secondary"
          onClick={() => setShowPrivacy((open) => !open)}
          aria-expanded={showPrivacy}
        >
          <Info className="mr-1.5 h-4 w-4" aria-hidden="true" />
          What gets sent
        </button>

        {state?.access.aiCredits ? <AiCreditsMeter credits={state.access.aiCredits} /> : null}
      </div>

      {showPrivacy ? (
        <p className="rounded-xl border border-line bg-surface-sunken p-3 text-xs text-ink-2">
          {state?.privacyNotice}
        </p>
      ) : null}

      {/* Announced, not just coloured. */}
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
      {message ? (
        <p className="rounded-xl border border-line bg-surface p-3 text-sm text-ink-2">{message}</p>
      ) : null}

      {result ? (
        <>
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-sm text-ink">{result.summary}</p>
            <p className="mt-1 text-xs text-muted">
              For {result.job.title} at {result.job.company} · fit {result.job.fitScore}/100 (
              {result.job.fitTier})
            </p>
          </div>

          {isStale ? (
            <div className="rounded-xl border border-danger/40 bg-danger/5 p-3" role="alert">
              <p className="flex items-start gap-2 text-sm font-medium text-danger-text">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                These suggestions are out of date
              </p>
              <ul className="mt-1 list-disc pl-6 text-xs text-ink-2">
                {(state?.optimization?.staleReasons ?? []).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-2">
                Run it again before accepting anything. We will not write old advice onto a document
                that has moved on.
              </p>
            </div>
          ) : null}

          {result.meta.proposedCount > result.meta.acceptedCount ? (
            <details className="rounded-xl border border-line bg-surface-sunken p-3">
              <summary className="cursor-pointer text-xs font-medium text-ink-2">
                {result.meta.proposedCount - result.meta.acceptedCount} suggestion
                {result.meta.proposedCount - result.meta.acceptedCount === 1 ? '' : 's'} were removed
                before you saw them
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {result.rejected.map((entry, index) => (
                  <li key={`${entry.kind}-${entry.section}-${index}`}>
                    {entry.detail}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {visible.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface p-3 text-sm text-ink-2">
              {result.meta.acceptedCount === 0
                ? 'We could not find any change we were confident enough to show you. That is a normal outcome — your resume may already say the right things for this role.'
                : 'You have dismissed every suggestion. Nothing was changed.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((operation) => {
                const isAccepted = accepted.has(operation.id);
                const isEditing = editing === operation.id;
                const text = editedText[operation.id] ?? operation.proposedText;
                return (
                  <li
                    key={operation.id}
                    className={`rounded-xl border p-4 transition-colors ${
                      isAccepted ? 'border-accent bg-accent/5' : 'border-line bg-surface'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{operation.sectionLabel}</p>
                        <span className={`badge mt-1 ${CONFIDENCE_STYLES[operation.confidence]}`}>
                          {operation.confidence.toLowerCase()} confidence
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                            isAccepted ? 'border-accent bg-accent text-accent-ink' : 'border-line text-ink-2'
                          }`}
                          aria-label={isAccepted ? `Stop accepting ${operation.sectionLabel}` : `Accept ${operation.sectionLabel}`}
                          aria-pressed={isAccepted}
                          onClick={() => {
                            setAccepted((current) => {
                              const next = new Set(current);
                              if (next.has(operation.id)) next.delete(operation.id);
                              else next.add(operation.id);
                              return next;
                            });
                            setRejected((current) => {
                              const next = new Set(current);
                              next.delete(operation.id);
                              return next;
                            });
                          }}
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                            rejected.has(operation.id) ? 'border-danger bg-danger/10 text-danger-text' : 'border-line text-ink-2'
                          }`}
                          aria-label={`Dismiss ${operation.sectionLabel}`}
                          onClick={() => {
                            setRejected((current) => new Set(current).add(operation.id));
                            setAccepted((current) => {
                              const next = new Set(current);
                              next.delete(operation.id);
                              return next;
                            });
                          }}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-ink-2">{operation.reason}</p>

                    {operation.targetRequirement ? (
                      <p className="mt-2 rounded-lg bg-surface-sunken p-2 text-xs text-muted">
                        <span className="font-medium text-ink-2">From the job:</span>{' '}
                        {operation.targetRequirement}
                      </p>
                    ) : null}

                    <div className="mt-3 space-y-2 text-sm">
                      {operation.originalText ? (
                        <div>
                          <p className="text-xs font-medium text-muted">Currently</p>
                          <p className="mt-0.5 rounded-lg border border-line bg-surface-sunken p-2 text-ink-2 line-through decoration-muted/50">
                            {operation.originalText}
                          </p>
                        </div>
                      ) : null}

                      <div>
                        <p className="text-xs font-medium text-muted">Proposed</p>
                        {isEditing ? (
                          <div className="mt-0.5 space-y-2">
                            <textarea
                              className="input resize-y"
                              rows={3}
                              value={text}
                              aria-label={`Edit the proposed ${operation.sectionLabel.toLowerCase()}`}
                              onChange={(event) =>
                                setEditedText((current) => ({ ...current, [operation.id]: event.target.value }))
                              }
                            />
                            <p className="text-xs text-muted">
                              Your version is checked against your resume in exactly the same way, so an
                              edit cannot introduce a claim you have not made.
                            </p>
                            <div className="flex gap-2">
                              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                                Done
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() =>
                                  setEditedText((current) => {
                                    const next = { ...current };
                                    delete next[operation.id];
                                    return next;
                                  })
                                }
                              >
                                Reset
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-0.5 rounded-lg border border-line bg-surface-sunken p-2 text-ink">
                            {text}
                          </p>
                        )}
                      </div>
                    </div>

                    {!isEditing ? (
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-accent-text underline underline-offset-2"
                        onClick={() => {
                          setEditing(operation.id);
                          setEditedText((current) => ({
                            ...current,
                            [operation.id]: current[operation.id] ?? operation.proposedText,
                          }));
                        }}
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                        Edit before accepting
                      </button>
                    ) : null}

                    {operation.warnings.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-xs text-warn-text">
                        {operation.warnings.map((warning) => (
                          <li key={warning} className="flex items-start gap-1.5">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                            {warning}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {operation.evidence.length > 0 ? (
                      <details className="mt-3">
                        <summary className="flex cursor-pointer items-center gap-1 text-xs text-muted">
                          <ChevronDown className="h-3 w-3" aria-hidden="true" />
                          Where this comes from
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {operation.evidence.map((item, index) => (
                            <li key={`${item.source}-${index}`} className="text-xs text-muted">
                              <span className="font-medium text-ink-2">
                                {item.source === 'JOB_DESCRIPTION'
                                  ? 'Job description'
                                  : item.source === 'CAREER_PROFILE'
                                    ? 'Your career profile'
                                    : item.source === 'RESUME_TEXT'
                                      ? 'Your resume'
                                      : 'Job details'}
                              </span>
                              {item.excerpt ? <span> — “{item.excerpt}”</span> : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {result.informationGaps.length > 0 ? (
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-sm font-medium text-ink">Things only you can answer</p>
              <p className="mt-1 text-xs text-muted">
                We did not fill these in. A number we invent is worse than no number.
              </p>
              <ul className="mt-3 space-y-2 text-sm text-ink-2">
                {result.informationGaps.map((gap) => (
                  <li key={gap.question}>
                    <p className="text-ink">{gap.question}</p>
                    <p className="text-xs text-muted">{gap.why}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button
              type="button"
              className="btn-primary"
              disabled={accepted.size === 0 || isStale || applying}
              onClick={() => void apply()}
            >
              {applying ? (
                <Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Apply {accepted.size} accepted change{accepted.size === 1 ? '' : 's'}
            </button>
            {isStale ? (
              <button type="button" className="btn-secondary" onClick={() => void run()} disabled={phase === 'running'}>
                <RotateCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Run again
              </button>
            ) : null}
            <p className="text-xs text-muted">
              Only the accepted changes are applied. Everything else stays exactly as it is.
            </p>
          </div>
        </>
      ) : null}

      {phase === 'error' ? (
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          Try loading again
        </button>
      ) : null}
    </section>
  );
}