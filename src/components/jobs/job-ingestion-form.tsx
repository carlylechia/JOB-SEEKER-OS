'use client';

import { useState } from 'react';
import { JobFormValues, JobIngestionResult } from '@/types';

export function JobIngestionForm({
  onApply,
}: {
  onApply: (prefill: Partial<JobFormValues>, result: JobIngestionResult) => void;
}) {
  const [jobUrl, setJobUrl] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JobIngestionResult | null>(null);

  async function handleParse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/ingest-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobUrl, jobDescription }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.details?.join(', ') || payload.error || 'Unable to parse job input.');
      }

      setResult(payload as JobIngestionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse job input.');
      setResult(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="card-pad space-y-4">
      <div>
        <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">Capture faster</div>
        <h3 className="mt-2 text-xl font-semibold">Paste a job link or description to prefill the form</h3>
        <p className="muted mt-2 text-sm leading-7">
          This parser extracts likely fields like role title, company, location, remote signals, stack clues, salary hints,
          and scoring suggestions before you save the lead.
        </p>
      </div>

      <form className="grid gap-4" onSubmit={handleParse}>
        <div>
          <label className="mb-2 block text-sm text-muted">Job URL</label>
          <input className="input" placeholder="https://company.com/careers/role" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Or paste the job description</label>
          <textarea className="input min-h-40" placeholder="Paste the job description here..." value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} />
        </div>
        {error ? <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Parsing...' : 'Parse and prefill'}
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              setJobUrl('');
              setJobDescription('');
              setResult(null);
              setError(null);
            }}
          >
            Reset
          </button>
        </div>
      </form>

      {result ? (
        <div className="rounded-2xl border border-line bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-sky-500/10 text-sky-200">Prefill ready</span>
            <span className="text-xs text-muted">Source: {result.sourceMode}</span>
          </div>
          {result.signals.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.signals.map((signal) => (
                <span key={signal} className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted">
                  {signal}
                </span>
              ))}
            </div>
          ) : null}
          <p className="mt-4 text-sm leading-7 text-muted">
            Review the extracted fields below, adjust anything that needs correction, then save the lead to your workspace.
          </p>
          <div className="mt-4">
            <button className="btn-primary" type="button" onClick={() => onApply(result.prefill, result)}>
              Use extracted fields
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
