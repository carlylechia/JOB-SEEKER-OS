'use client';

/**
 * Resume analysis CTA.
 *
 * Lives on the Profile page next to the stored resume, which is where a user
 * already goes to manage that document. It is an addition to the existing
 * upload flow, not a replacement: upload, download and replace behave exactly
 * as they did before.
 *
 * All copy about what happens to the user's resume is truthful about the
 * configured provider. There is no claim here that we do not actually make.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader, RefreshCw, Sparkles } from 'lucide-react';

type DocumentRow = {
  id: string;
  fileName: string;
  format: string;
  sizeBytes: number;
  isPrimary: boolean;
  createdAt: string;
};

type ExtractionRow = {
  id: string;
  resumeId: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

type State = {
  documents: DocumentRow[];
  extractions: ExtractionRow[];
  access: {
    canAnalyze: boolean;
    canUseCareerProfile: boolean;
    plan: string;
    isAdmin: boolean;
    isTrialing: boolean;
  };
  privacyNotice: string;
};

type Phase = 'idle' | 'loading' | 'running' | 'done' | 'error';

export function ResumeAnalysisCta({ hasResume }: { hasResume: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [retryable, setRetryable] = useState(false);
  const [resumeId, setResumeId] = useState<string>('');
  // Refs, not state: the click handler must see the current value immediately
  // so a double click cannot start two runs before React re-renders.
  const runningRef = useRef(false);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const res = await fetch('/api/resume/intelligence', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load resume status.');
      const json = (await res.json()) as State;
      setState(json);
      setResumeId((current) => current || json.documents.find((d) => d.isPrimary)?.id || json.documents[0]?.id || '');
      setPhase('idle');
    } catch {
      setPhase('error');
      setMessage('We could not load your resume status.');
      setRetryable(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latestCompleted = state?.extractions.find((e) => e.status === 'COMPLETED') ?? null;
  const latestFailure = state?.extractions.find((e) => e.status === 'FAILED') ?? null;

  async function analyse(force = false) {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase('running');
    setMessage('');
    setRetryable(false);

    try {
      const res = await fetch('/api/resume/intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeId: resumeId || undefined, force }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        extractionId?: string;
        outcome?: string;
      };

      if (!res.ok) {
        setPhase('error');
        setMessage(json.error?.message ?? 'Analysis failed. Please try again.');
        setRetryable(true);
        return;
      }

      setPhase('done');
      router.push(`/career-profile?extraction=${json.extractionId}`);
    } catch {
      setPhase('error');
      setMessage('We could not reach the analysis service. Check your connection and try again.');
      setRetryable(true);
    } finally {
      runningRef.current = false;
      void load();
    }
  }

  const canAnalyze = state?.access.canAnalyze ?? false;
  const busy = phase === 'running';

  if (!hasResume && !state?.documents.length) {
    return null;
  }

  return (
    <section className="card-pad space-y-4" aria-labelledby="resume-intelligence-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="resume-intelligence-heading"
            className="flex items-center gap-2 text-sm font-medium text-ink"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[#8A6D1F]" aria-hidden="true" />
            Career profile
          </h2>
          <p className="muted mt-1">
            Turn your resume into a structured career profile you can edit, review and reuse
            across every application.
          </p>
        </div>
      </div>

      {/* Document picker: an existing user may have more than one resume stored,
          and we must not assume the newest one is the one they want analysed. */}
      {(state?.documents.length ?? 0) > 1 && (
        <div className="max-w-sm">
          <label htmlFor="resume-source" className="mb-1.5 block text-xs font-medium text-muted">
            Which resume should we analyse?
          </label>
          <select
            id="resume-source"
            className="input"
            value={resumeId}
            disabled={busy}
            onChange={(event) => setResumeId(event.target.value)}
          >
            {state?.documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.fileName}
                {doc.isPrimary ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Status is announced, not just coloured, so a screen reader hears the
          outcome of a run they cannot see. */}
      <p role="status" aria-live="polite" className="sr-only">
        {phase === 'running' && 'Analysing your resume. This usually takes under a minute.'}
        {phase === 'done' && 'Analysis complete. Opening your review.'}
        {phase === 'error' && message}
      </p>

      {!canAnalyze ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-black/[0.03] px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-muted">
            AI resume analysis is available on Pro. Your resume stays saved and downloadable.
          </p>
          <Link href="/settings/billing" className="btn-primary text-xs">
            {state?.access.isTrialing ? 'View my plan' : 'See Pro'}
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void analyse(false)}
            disabled={busy || phase === 'loading'}
          >
            {busy ? (
              <>
                <Loader className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Analysing…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {latestCompleted ? 'Review career profile' : 'Analyse resume'}
              </>
            )}
          </button>

          {latestCompleted && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void analyse(true)}
              disabled={busy}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Run analysis again
            </button>
          )}

          {latestCompleted && (
            <Link href={`/career-profile?extraction=${latestCompleted.id}`} className="btn-secondary text-xs">
              Open last review
            </Link>
          )}
        </div>
      )}

      {phase === 'running' && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Extracting your resume and reading it. This can take up to a minute.
        </p>
      )}

      {phase === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{message}</p>
            {retryable && (
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

      {latestFailure && phase === 'idle' && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Your last analysis did not finish. You can run it again without re-uploading your resume.
        </p>
      )}

      {latestCompleted && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
          Last analysed{' '}
          {new Date(latestCompleted.completedAt ?? latestCompleted.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          {latestCompleted.id === latestCompleted.id && ' — nothing has changed in your resume since.'}
        </p>
      )}

      {state?.privacyNotice && (
        <details className="rounded-xl border border-line bg-black/[0.02] px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">
            What happens to my resume?
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-muted">{state.privacyNotice}</p>
        </details>
      )}
    </section>
  );
}