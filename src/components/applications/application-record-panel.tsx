'use client';

/**
 * Application record panel.
 *
 * Shows the auditable lifecycle record for this job: attempts, evidence and
 * status changes. It makes the safety rule visible rather than implicit:
 *
 *   - "Record that I applied" creates an ATTEMPTED record and leaves the
 *     application IN_PROGRESS. It can never mark it applied.
 *   - "Record confirmed submission" asks for the kind of evidence and only
 *     then moves the application to APPLIED.
 *
 * The pipeline status shown at the top of the job page is deliberately separate
 * and is not changed here.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Clock,
  FileCheck,
  Loader,
  ShieldCheck,
} from 'lucide-react';
import {
  APPLICATION_TRANSITIONS,
  ATTEMPT_CHANNELS,
  ATTEMPT_LABELS,
  EVIDENCE_KINDS,
  EVIDENCE_LABELS,
  STATUS_LABELS,
  isApplicationStatus,
  type ApplicationStatus,
  type AttemptChannel,
  type AttemptStatus,
  type EvidenceKind,
} from '@/lib/applications/statuses';

type Attempt = {
  id: string;
  channel: string;
  status: string;
  attemptedAt: string;
  evidenceKind: string | null;
  evidenceRef: string | null;
  evidenceSummary: string | null;
};

type Event = {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string;
  reason: string | null;
  createdAt: string;
};

type Detail = {
  application: {
    id: string;
    status: string;
    updatedAt: string;
  };
  attempts: Attempt[];
  events: Event[];
};

const CHANNEL_LABELS: Record<string, string> = {
  MANUAL: 'Manually',
  WEB_FORM: 'Web form',
  EMAIL: 'Email',
  EXTENSION: 'Browser extension',
  REFERRAL: 'Referral',
  OTHER: 'Other',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function eventCopy(event: Event): string {
  switch (event.type) {
    case 'SUBMISSION_CONFIRMED':
      return 'Submission confirmed with evidence.';
    case 'ATTEMPT_RECORDED':
      return 'An application attempt was recorded.';
    case 'EVIDENCE_ATTACHED':
      return 'Evidence was attached to the application.';
    case 'STATUS_CHANGED':
      return `Status changed from ${event.fromStatus ?? '—'} to ${event.toStatus ?? '—'}.`;
    case 'WITHDRAWN':
      return 'The application was withdrawn.';
    default:
      return event.type;
  }
}

export function ApplicationRecordPanel({
  jobId,
  pipelineStatus,
}: {
  jobId: string;
  pipelineStatus: string;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAttempt, setShowAttempt] = useState(false);
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [attemptStatus, setAttemptStatus] = useState<AttemptStatus>('ATTEMPTED');
  const [channel, setChannel] = useState<AttemptChannel>('WEB_FORM');
  const [reason, setReason] = useState('');
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>('CONFIRMATION_PAGE');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [evidenceSummary, setEvidenceSummary] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/application`, {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 404) {
        setDetail(null);
        return;
      }
      if (!response.ok) {
        setError(payload?.error?.message ?? 'Could not load the application record.');
        return;
      }
      setDetail(payload as Detail);
    } catch {
      setError('Could not load the application record.');
    } finally {
      setLoaded(true);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitAttempt(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/application/attempt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message ?? 'The attempt could not be recorded.');
        return;
      }
      setShowAttempt(false);
      setShowConfirmed(false);
      setReason('');
      setEvidenceRef('');
      setEvidenceSummary('');
      await load();
    } catch {
      setError('The attempt could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function move(toStatus: ApplicationStatus) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/application`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStatus }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message ?? 'The status could not be changed.');
        return;
      }
      await load();
    } catch {
      setError('The status could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  const status: ApplicationStatus | null =
    detail && isApplicationStatus(detail.application.status)
      ? detail.application.status
      : null;
  const transitions = status ? APPLICATION_TRANSITIONS[status] : [];

  return (
    <section className="card-pad space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <ShieldCheck className="h-4 w-4 text-accent-text" />
            Application record
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            What you prepared, what you submitted, and the evidence behind it. Your pipeline
            status ({pipelineStatus.toLowerCase()}) is separate and is not changed here.
          </p>
        </div>
        {status ? (
          <span className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink">
            {STATUS_LABELS[status]}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="flex items-start gap-2 text-sm text-danger-text">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      ) : null}

      {loaded && !detail ? (
        <div className="space-y-3 rounded-xl border border-line bg-surface-sunken px-4 py-4">
          <p className="text-sm text-muted">
            No application record yet. Recording an attempt creates one and never claims it was
            submitted without evidence.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary gap-1.5 text-sm"
              disabled={busy}
              onClick={() => void submitAttempt({ channel: 'WEB_FORM', status: 'ATTEMPTED' })}
            >
              {busy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <CircleHelp className="h-3.5 w-3.5" />}
              Record that I applied
            </button>
            <button
              type="button"
              className="btn-secondary gap-1.5 text-sm"
              disabled={busy}
              onClick={() => {
                setShowConfirmed((current) => !current);
                setShowAttempt(false);
              }}
            >
              <FileCheck className="h-3.5 w-3.5" /> Record confirmed submission
            </button>
          </div>
        </div>
      ) : null}

      {detail ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary gap-1.5 text-sm"
              disabled={busy}
              onClick={() => {
                setShowAttempt((current) => !current);
                setShowConfirmed(false);
              }}
            >
              <CircleHelp className="h-3.5 w-3.5" /> Record an attempt
            </button>
            <button
              type="button"
              className="btn-secondary gap-1.5 text-sm"
              disabled={busy}
              onClick={() => {
                setShowConfirmed((current) => !current);
                setShowAttempt(false);
              }}
            >
              <FileCheck className="h-3.5 w-3.5" /> Record confirmed submission
            </button>
          </div>

          {transitions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
              <span className="font-medium text-ink">Move to:</span>
              {transitions.map((target) => (
                <button
                  key={target}
                  type="button"
                  className="rounded-full border border-line px-2.5 py-1 font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void move(target)}
                >
                  {STATUS_LABELS[target]}
                </button>
              ))}
            </div>
          ) : null}

          {showAttempt ? (
            <form
              className="space-y-3 rounded-xl border border-line bg-surface-sunken px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAttempt({
                  channel,
                  status: attemptStatus,
                  reason: reason.trim() || undefined,
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-muted">
                  Outcome
                  <select
                    className="input mt-1"
                    value={attemptStatus}
                    onChange={(event) => setAttemptStatus(event.target.value as AttemptStatus)}
                  >
                    <option value="ATTEMPTED">{ATTEMPT_LABELS.ATTEMPTED}</option>
                    <option value="FAILED">{ATTEMPT_LABELS.FAILED}</option>
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Channel
                  <select
                    className="input mt-1"
                    value={channel}
                    onChange={(event) => setChannel(event.target.value as AttemptChannel)}
                  >
                    {ATTEMPT_CHANNELS.map((value) => (
                      <option key={value} value={value}>
                        {CHANNEL_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs text-muted">
                Note (optional)
                <textarea
                  className="input mt-1 min-h-[64px]"
                  value={reason}
                  maxLength={600}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted">
                This records an attempt only. It does not mark the application as applied.
              </p>
              <button type="submit" className="btn-primary gap-1.5 text-sm" disabled={busy}>
                {busy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : null} Save attempt
              </button>
            </form>
          ) : null}

          {showConfirmed ? (
            <form
              className="space-y-3 rounded-xl border border-line bg-surface-sunken px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAttempt({
                  channel,
                  status: 'CONFIRMED',
                  evidenceKind,
                  evidenceRef: evidenceRef.trim() || undefined,
                  evidenceSummary: evidenceSummary.trim() || undefined,
                });
              }}
            >
              <p className="text-xs leading-5 text-muted">
                Use this only when you have something that proves the employer received the
                application: a confirmation page, an email, or an ATS webhook.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-muted">
                  Evidence
                  <select
                    className="input mt-1"
                    value={evidenceKind}
                    onChange={(event) => setEvidenceKind(event.target.value as EvidenceKind)}
                  >
                    {EVIDENCE_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {EVIDENCE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Reference (optional)
                  <input
                    className="input mt-1"
                    value={evidenceRef}
                    maxLength={240}
                    placeholder="Message id, ticket, filename"
                    onChange={(event) => setEvidenceRef(event.target.value)}
                  />
                </label>
              </div>
              <label className="block text-xs text-muted">
                What the evidence shows
                <textarea
                  className="input mt-1 min-h-[64px]"
                  value={evidenceSummary}
                  maxLength={600}
                  onChange={(event) => setEvidenceSummary(event.target.value)}
                />
              </label>
              <button type="submit" className="btn-primary gap-1.5 text-sm" disabled={busy}>
                {busy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Confirm submission
              </button>
            </form>
          ) : null}

          {detail.attempts.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">Attempts</h3>
              {detail.attempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">
                      {ATTEMPT_LABELS[attempt.status as AttemptStatus] ?? attempt.status}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <Clock className="h-3 w-3" /> {formatDate(attempt.attemptedAt)} ·{' '}
                      {CHANNEL_LABELS[attempt.channel] ?? attempt.channel}
                    </span>
                  </div>
                  {attempt.evidenceKind ? (
                    <p className="mt-1 text-xs text-muted">
                      Evidence: {EVIDENCE_LABELS[attempt.evidenceKind as EvidenceKind] ?? attempt.evidenceKind}
                      {attempt.evidenceRef ? ` · ${attempt.evidenceRef}` : ''}
                    </p>
                  ) : null}
                  {attempt.evidenceSummary ? (
                    <p className="mt-1 text-xs leading-5 text-muted">{attempt.evidenceSummary}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {detail.events.length > 0 ? (
            <div className="space-y-2 border-t border-line pt-3">
              <h3 className="text-sm font-semibold text-ink">Timeline</h3>
              <ol className="space-y-2">
                {detail.events.map((event) => (
                  <li key={event.id} className="flex items-start gap-2 text-xs leading-5 text-muted">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-accent-text" />
                    <span>
                      {eventCopy(event)}
                      {event.reason ? <span className="block text-muted">“{event.reason}”</span> : null}
                      <span className="block text-[10px] text-muted">
                        {formatDate(event.createdAt)} · {event.actor.toLowerCase()}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
