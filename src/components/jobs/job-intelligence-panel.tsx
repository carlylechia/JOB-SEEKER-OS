'use client';

/**
 * AI Job Intelligence panel.
 *
 * Lives on the job detail page, next to the score breakdown, because that is
 * where a user already goes to ask "does this role fit me?". It is an
 * addition, not a replacement: the deterministic score and tier render
 * exactly as before, and this panel explains them.
 *
 * Three rules the UI keeps, and which are why it reads the way it does:
 *
 *  1. The score and the AI's verdict are shown as two separate things. A user
 *     can see `fitScore 78 · tier A` and `Potential match` side by side and
 *     understand that one is arithmetic and the other is prose.
 *
 *  2. "We don't know" is a first-class state, not an error. Unknown
 *     dimensions, missing evidence and unconfirmed profile data all render as
 *     visible, labelled uncertainty rather than being quietly omitted.
 *
 *  3. Nothing here promises anything. No copy implies an interview, an offer,
 *     or that a role is legally open to the user.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  Loader,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';

import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
} from '@/lib/job-intelligence/categories';
import { DIMENSION_LABELS, type DimensionMap, type DimensionOutcome } from '@/lib/job-intelligence/schema';
import type { JobIntelligenceResult, OverallCategory } from '@/lib/job-intelligence/schema';
import { AiCreditsMeter } from '@/components/billing/ai-credits-meter';
import type { AiCreditsPayload } from '@/lib/billing/ai-credits';

// ─── Presentation vocabulary ───────────────────────────────────────────────

/**
 * Outcome wording.
 *
 * Plain language on purpose. "Doesn't fit" reads as a verdict about a person;
 * "doesn't fit your preferences" reads as a fact about two pieces of
 * information, which is what it actually is.
 */
const OUTCOME_LABELS: Record<DimensionOutcome, string> = {
  MATCH: 'Fits',
  PARTIAL_MATCH: 'Partly fits',
  MISMATCH: 'Does not fit',
  UNKNOWN: 'Not enough information',
  NOT_APPLICABLE: 'Not applicable',
};

const OUTCOME_STYLES: Record<DimensionOutcome, string> = {
  MATCH: 'bg-success/15 text-success-text',
  PARTIAL_MATCH: 'bg-accent/20 text-accent-text',
  MISMATCH: 'bg-danger/15 text-danger-text',
  UNKNOWN: 'bg-surface-sunken text-muted',
  NOT_APPLICABLE: 'bg-surface-sunken text-muted',
};

const CATEGORY_STYLES: Record<OverallCategory, string> = {
  STRONG_MATCH: 'bg-success/15 text-success-text border-success/30',
  POTENTIAL_MATCH: 'bg-accent/20 text-accent-text border-accent/30',
  STRETCH_OPPORTUNITY: 'bg-warn/15 text-warn-text border-warn/30',
  LOW_MATCH: 'bg-danger/15 text-danger-text border-danger/30',
  INSUFFICIENT_INFORMATION: 'bg-surface-sunken text-muted border-line',
};

const IMPORTANCE_LABELS: Record<string, string> = {
  REQUIRED: 'Required',
  PREFERRED: 'Preferred',
  HELPFUL: 'Helpful',
  UNCLEAR: 'Not marked as required',
};

const ACTION_LABELS: Record<string, string> = {
  CONFIRM_WITH_EMPLOYER: 'Ask the employer',
  CLARIFY_SALARY_RANGE: 'Clarify the salary range',
  VERIFY_REMOTE_ELIGIBILITY: 'Verify remote eligibility',
  EMPHASISE_EXISTING_EVIDENCE: 'Emphasise existing evidence',
  UPDATE_CAREER_PROFILE: 'Complete your career profile',
  CONSIDER_ADJACENT_ROLE: 'Consider whether this adjacent role suits you',
  ADD_JOB_DESCRIPTION: 'Add the job description',
  REVIEW_TARGET_TITLES: 'Review your target titles',
};

const EVIDENCE_SOURCE_LABELS: Record<string, string> = {
  JOB_DESCRIPTION: 'Job description',
  JOB_METADATA: 'Job details',
  CAREER_PROFILE: 'Your career profile',
  WORK_EXPERIENCE: 'Your work experience',
  USER_PREFERENCES: 'Your preferences',
  DETERMINISTIC_SCORE: 'Your fit score',
};

// ─── Wire types ────────────────────────────────────────────────────────────

type AnalysisEnvelope = {
  id: string;
  status: string;
  isFresh: boolean;
  completedAt: string | null;
  model: string | null;
  data: JobIntelligenceResult;
};

type State = {
  available: boolean;
  reason?: string;
  job?: { id: string; title: string; company: string; hasDescription: boolean };
  deterministic?: {
    fitScore: number;
    fitTier: string;
    titleMatch: boolean;
    blockedBy: string[];
    titleRelationship: { relationship: string; reason: string };
  };
  profile?: { completeness: string; confirmed: boolean; missingInputs: string[] };
  analysis: AnalysisEnvelope | null;
  access: {
    canAnalyze: boolean;
    plan: string;
    isAdmin: boolean;
    isTrialing: boolean;
    aiCredits: AiCreditsPayload;
  };
  privacyNotice?: string;
};

type Phase = 'idle' | 'loading' | 'running' | 'error';

// ─── Component ─────────────────────────────────────────────────────────────

export function JobIntelligencePanel({ jobId }: { jobId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [retryable, setRetryable] = useState(false);
  // A ref, not state: the click handler must see the current value
  // immediately, so a double click cannot start two runs before React
  // re-renders.
  const runningRef = useRef(false);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const res = await fetch(`/api/jobs/${jobId}/intelligence`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load the analysis.');
      const json = (await res.json()) as State;
      setState(json);
      setPhase('idle');
    } catch {
      setPhase('error');
      setMessage('We could not load the job analysis.');
      setRetryable(true);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function analyse(force = false) {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase('running');
    setMessage('');
    setRetryable(false);

    try {
      const res = await fetch(`/api/jobs/${jobId}/intelligence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        outcome?: string;
        data?: JobIntelligenceResult;
      };

      if (!res.ok) {
        setPhase('error');
        setMessage(json.error?.message ?? 'The analysis failed. Please try again.');
        setRetryable(true);
        return;
      }

      if (json.data) {
        // A successful run is a single round trip; fold it in rather than
        // making the user wait for a second fetch.
        setState((prev) =>
          prev
            ? {
                ...prev,
                analysis: {
                  id: '',
                  status: 'COMPLETED',
                  isFresh: true,
                  completedAt: new Date().toISOString(),
                  model: null,
                  data: json.data!,
                },
              }
            : prev,
        );
      }
      setPhase('idle');
    } catch {
      setPhase('error');
      setMessage('We could not reach the analysis service. Check your connection and try again.');
      setRetryable(true);
    } finally {
      runningRef.current = false;
      void load();
    }
  }

  if (phase === 'loading' && !state) {
    return (
      <section className="card-pad" aria-busy="true">
        <p className="muted flex items-center gap-2">
          <Loader className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading job analysis…
        </p>
      </section>
    );
  }

  if (!state || !state.available) {
    return null;
  }

  const canAnalyze = state.access.canAnalyze;
  const busy = phase === 'running';
  const analysis = state.analysis;
  const data = analysis?.data ?? null;

  return (
    <section className="card-pad space-y-5" aria-labelledby="job-intelligence-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="job-intelligence-heading"
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[#8A6D1F]" aria-hidden="true" />
            Why this job fits you
          </h3>
          <p className="muted mt-1">
            Personalised to your career profile and preferences. Guidance, not a decision.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {!canAnalyze && (
            <Link href="/settings/billing" className="btn-secondary text-xs">
              {state.access.isTrialing ? 'View my plan' : 'See Pro'}
            </Link>
          )}
          {state.access.aiCredits ? <AiCreditsMeter credits={state.access.aiCredits} /> : null}
        </div>
      </div>

      {/* The deterministic score is shown first and separately. It is the
          number the scoring engine produced, and the explanation below never
          replaces it. */}
      {state.deterministic && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-sunken px-4 py-3">
          <div>
            <div className="muted text-xs">Your fit score</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-xl font-semibold tabular-nums">
                {state.deterministic.fitScore}
              </span>
              <span className="muted text-xs">/ 100 · tier {state.deterministic.fitTier}</span>
            </div>
          </div>
          <p className="min-w-0 flex-1 text-xs text-muted">
            Computed by your matching rules. The analysis below explains this number — it does
            not change it.
          </p>
        </div>
      )}

      {state.deterministic?.blockedBy?.length ? (
        <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <p className="text-sm text-ink">
            This job scores zero because of {state.deterministic.blockedBy.join(' and ')}. That
            is a rule in your matching engine, and no analysis can override it.
          </p>
        </div>
      ) : null}

      {!canAnalyze && (
        <div className="rounded-xl border border-line bg-black/[0.03] px-4 py-3">
          <p className="text-sm text-muted">
            AI job analysis is available on Pro. Your job, its score and its fit tier stay exactly
            as they are.
          </p>
        </div>
      )}

      {canAnalyze && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void analyse(false)}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Analysing…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {analysis ? 'Re-check this job' : 'Analyse this job'}
              </>
            )}
          </button>

          {analysis && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void analyse(true)}
              disabled={busy}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Run again
            </button>
          )}
        </div>
      )}

      {/* Status is announced, not just coloured, so a screen reader hears the
          outcome of a run they cannot see. */}
      <p role="status" aria-live="polite" className="sr-only">
        {busy && 'Analysing this job against your profile.'}
        {phase === 'error' && message}
      </p>

      {busy && (
        <p className="muted flex items-center gap-2 text-sm">
          <Loader className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Reading the posting and comparing it to your profile.
        </p>
      )}

      {phase === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{message}</p>
            {retryable && canAnalyze && (
              <button
                type="button"
                className="mt-2 text-xs font-medium text-[#8A6D1F] underline underline-offset-2"
                onClick={() => void analyse(false)}
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {!data && !busy && phase !== 'error' && (
        <p className="muted text-sm">
          {state.job?.hasDescription
            ? 'Run an analysis to see where this role lines up with your experience, and where it does not.'
            : 'This job has no description saved, so an analysis would use the role details alone. Add the description first for a much fuller picture.'}
        </p>
      )}

      {state.job && !state.job.hasDescription && !data && (
        <p className="muted text-xs">
          You can paste the posting into the job editor, or import it from a link.
        </p>
      )}

      {data && <AnalysisBody analysis={data} envelope={analysis!} />}

      {!canAnalyze && state.profile && state.profile.missingInputs.length > 0 && (
        <p className="muted text-xs">
          Still worth knowing: your profile is missing {state.profile.missingInputs.join(', ')}.
          Filling those in makes every job analysis more useful.
        </p>
      )}

      {state.privacyNotice && (
        <details className="rounded-xl border border-line bg-black/[0.02] px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">
            What happens to my data?
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-muted">{state.privacyNotice}</p>
        </details>
      )}
    </section>
  );
}

// ─── The analysis itself ───────────────────────────────────────────────────

function AnalysisBody({
  analysis,
  envelope,
}: {
  analysis: JobIntelligenceResult;
  envelope: AnalysisEnvelope;
}) {
  const category = analysis.overallCategory;

  return (
    <div className="space-y-5 border-t border-line pt-5">
      {/* Freshness. A result the user's inputs have moved past is labelled as
          such rather than presented as current. */}
      {!envelope.isFresh && (
        <div className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn/[0.07] px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-text" aria-hidden="true" />
          <p className="text-sm text-ink">
            This analysis was run{' '}
            {envelope.completedAt
              ? new Date(envelope.completedAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : 'earlier'}
            . Your job details, profile or preferences have changed since, so run it again for an
            up-to-date read.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className={`badge border ${CATEGORY_STYLES[category]}`}>{CATEGORY_LABELS[category]}</span>
        {analysis.meta.dataCompleteness !== 'COMPLETE' && (
          <span className="badge bg-surface-sunken text-muted">
            {analysis.meta.dataCompleteness === 'MINIMAL'
              ? 'Limited information'
              : 'Some information missing'}
          </span>
        )}
      </div>

      <p className="text-sm leading-relaxed text-muted">{CATEGORY_DESCRIPTIONS[category]}</p>
      <p className="text-sm leading-relaxed text-ink">{analysis.summary}</p>
      <p className="muted text-xs">{analysis.categoryRationale}</p>

      {/* Dimensions */}
      <div>
        <h4 className="text-sm font-semibold">Breakdown</h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(Object.keys(analysis.dimensions) as Array<keyof DimensionMap>).map((key) => (
            <DimensionCard
              key={key}
              label={DIMENSION_LABELS[key]}
              dimension={analysis.dimensions[key]}
            />
          ))}
        </div>
      </div>

      {/* Requirements */}
      {analysis.requirements.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">What the role asks for</h4>
          <div className="mt-3 space-y-2">
            {analysis.requirements.map((requirement) => (
              <div
                key={requirement.requirement}
                className="rounded-xl border border-line bg-surface-sunken p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`badge ${OUTCOME_STYLES[requirement.outcome]}`}
                  >
                    {OUTCOME_LABELS[requirement.outcome]}
                  </span>
                  <span className="badge bg-surface text-muted">
                    {IMPORTANCE_LABELS[requirement.importance] ?? requirement.importance}
                  </span>
                  <span className="text-sm font-medium text-ink">{requirement.requirement}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {requirement.explanation}
                </p>
                {requirement.uncertainty && (
                  <p className="mt-2 text-xs text-muted">⚠ {requirement.uncertainty}</p>
                )}
                <EvidenceList evidence={requirement.evidence} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next steps */}
      {analysis.recommendations.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">What to do next</h4>
          <ul className="mt-3 space-y-2">
            {analysis.recommendations.map((recommendation) => (
              <li
                key={`${recommendation.action}-${recommendation.detail}`}
                className="flex items-start gap-2 rounded-xl border border-line p-3"
              >
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-success-text"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    <span className="font-medium">
                      {ACTION_LABELS[recommendation.action] ?? recommendation.action}.
                    </span>{' '}
                    {recommendation.detail}
                  </p>
                  <p className="mt-1 text-xs text-muted">{recommendation.rationale}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Limitations */}
      {analysis.limitations.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">What this analysis could not cover</h4>
          <ul className="mt-3 space-y-1.5">
            {analysis.limitations.map((limitation) => (
              <li key={limitation} className="flex items-start gap-2 text-sm text-muted">
                <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{limitation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-line pt-3 text-xs text-muted">
        This is guidance to help you decide what to look into. It is not a prediction of how an
        application will go, and it is not a legal or work-authorisation assessment. Confirm
        anything time-sensitive — salary, location and eligibility — with the employer.
      </p>
    </div>
  );
}

function DimensionCard({
  label,
  dimension,
}: {
  label: string;
  dimension: JobIntelligenceResult['dimensions'][keyof DimensionMap];
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className={`badge shrink-0 ${OUTCOME_STYLES[dimension.outcome]}`}>
          {OUTCOME_LABELS[dimension.outcome]}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{dimension.explanation}</p>
      {dimension.uncertainty && (
        <p className="mt-2 text-xs text-muted">⚠ {dimension.uncertainty}</p>
      )}
      <EvidenceList evidence={dimension.evidence} />
    </div>
  );
}

/**
 * Evidence, shown as short excerpts with their source.
 *
 * These are verbatim quotes the server re-checked against the actual posting
 * and profile before storing, which is what makes them worth showing: a user
 * can confirm the claim without opening the original document.
 */
function EvidenceList({ evidence }: { evidence: JobIntelligenceResult['dimensions'][keyof DimensionMap]['evidence'] }) {
  if (!evidence.length) return null;

  return (
    <ul className="mt-2 space-y-1">
      {evidence.map((item, index) => (
        <li key={`${item.field}-${index}`} className="text-xs text-muted">
          <span className="font-medium">
            {EVIDENCE_SOURCE_LABELS[item.source] ?? item.source}
          </span>
          {item.excerpt ? (
            <>
              {' — '}
              <span className="italic">“{item.excerpt}”</span>
            </>
          ) : null}
          <span className="block opacity-80">{item.supports}</span>
        </li>
      ))}
    </ul>
  );
}