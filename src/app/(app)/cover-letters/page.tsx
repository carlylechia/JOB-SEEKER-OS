/**
 * Cover letters list.
 *
 * Shows the caller's cover letters, most recently updated first, with the
 * option to create a new one for a job. Reading the list never consumes AI
 * credits.
 */

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';

type LetterSummary = {
  id: string;
  jobId: string;
  title: string;
  status: string;
  version: number;
  thinInputs: boolean;
  createdAt: string;
  updatedAt: string;
};

async function listLetters(): Promise<LetterSummary[]> {
  const res = await fetch('/api/cover-letters', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load cover letters.');
  const json = (await res.json()) as { letters: LetterSummary[] };
  return json.letters;
}

export default function CoverLettersPage() {
  const [letters, setLetters] = useState<LetterSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        const data = await listLetters();
        if (!cancelled) setLetters(data);
      } catch {
        if (!cancelled) setError('Could not load cover letters. Please try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cover letters" subtitle="Tailored letters for your applications." />
        <div className="card-pad rounded-xl border border-danger/25 bg-danger/[0.05] p-4">
          <p className="text-sm text-ink">{error}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cover letters" subtitle="Tailored letters for your applications." />
        <div className="card-pad flex items-center gap-2 text-sm muted">
          <span className="animate-pulse">Loading letters…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cover letters"
        subtitle="Tailored, evidence-backed letters for your applications."
        action={
          <Link href="/jobs" className="btn-primary">
            Choose a job to write for
          </Link>
        }
      />

      {letters.length === 0 ? (
        <div className="card-pad text-center py-12">
          <div className="text-4xl mb-4">✉️</div>
          <h3 className="text-lg font-semibold">No cover letters yet</h3>
          <p className="muted mt-2 max-w-md mx-auto text-sm">
            Generate a cover letter from a job detail page. Each letter is
            tailored to the role and your career profile.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {letters.map((letter) => (
            <div
              key={letter.id}
              className="rounded-xl border border-line p-4 flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/cover-letters/${letter.id}`}
                  className="text-ink font-medium hover:text-accent-text"
                >
                  {letter.title}
                </Link>
                <div className="mt-1 text-xs text-muted">
                  {letter.jobId ? `Job · version {letter.version}` : ''}
                  {letter.thinInputs && ' · limited information'}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {new Date(letter.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <span
                className={`badge text-xs ${
                  letter.status === 'GENERATED'
                    ? 'bg-success/15 text-success-text'
                    : letter.status === 'ARCHIVED'
                      ? 'bg-surface-sunken text-ink'
                      : 'bg-accent/20 text-accent-text'
                }`}
              >
                {letter.status.charAt(0) + letter.status.slice(1).toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
