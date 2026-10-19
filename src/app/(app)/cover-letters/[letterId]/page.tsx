/**
 * Cover letter workspace.
 *
 * One page per letter: preview the generated draft, edit it, and save.
 * Reads are server-side; edits are client-side optimistically and persisted
 * through a secure server-side API. A refresh never erases edits — the letter
 * is persisted server-side and reloaded on return.
 */

'use client';

import Link from 'next/link';
import { notFound, useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';

type LetterEnvelope = {
  available: boolean;
  reason?: string;
  letter: {
    id: string;
    jobId: string;
    title: string;
    subject: string | null;
    content: string;
    salutation: string | null;
    signOff: string | null;
    status: string;
    version: number;
    thinInputs: boolean;
    createdAt: string;
    updatedAt: string;
  };
};

async function getLetter(letterId: string): Promise<LetterEnvelope> {
  const res = await fetch(`/api/cover-letters/${letterId}`, { cache: 'no-store' });
  if (res.status === 404) throw new NotFoundError();
  if (!res.ok) throw new Error('Could not load the cover letter.');
  return (await res.json()) as LetterEnvelope;
}

class NotFoundError extends Error {}

async function updateLetter(letterId: string, input: Partial<{
  title: string;
  content: string;
  subject: string | null;
  salutation: string | null;
  signOff: string | null;
  status: string;
}>) {
  const res = await fetch(`/api/cover-letters/${letterId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(json.error?.message ?? 'Could not save the cover letter.');
  }
  return (await res.json()) as { letter: { id: string } };
}

async function createLetter(jobId: string) {
  const res = await fetch('/api/cover-letters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(json.error?.message ?? 'Could not create the cover letter.');
  }
  return (await res.json()) as { letter: { id: string } };
}

export default function CoverLetterPage() {
  const params = useParams<{ letterId: string }>();
  const router = useRouter();
  const letterId = params.letterId;

  const [envelope, setEnvelope] = useState<LetterEnvelope | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const runningRef = useRef(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const json = await getLetter(letterId);
      if (!json.available) {
        notFound();
        return;
      }
      setEnvelope(json);
      setDraft(json.letter.content);
      setSubject(json.letter.subject ?? '');
    } catch {
      setError('We could not load the cover letter. Please try again.');
    }
  }, [letterId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cover letter" subtitle="Tailored, evidence-backed letter for your application." />
        <div className="card-pad rounded-xl border border-danger/25 bg-danger/[0.05] p-4">
          <p className="text-sm text-ink">{error}</p>
        </div>
      </div>
    );
  }

  if (!envelope) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cover letter" subtitle="Tailored, evidence-backed letter for your application." />
        <div className="card-pad flex items-center gap-2 text-sm muted">
          <span className="animate-pulse">Loading letter…</span>
        </div>
      </div>
    );
  }

  if (!envelope.available) {
    notFound();
    return null;
  }

  const { letter } = envelope;

  return (
    <div className="space-y-6">
      <PageHeader
        title={letter.title}
        subtitle={`Job: ${letter.title}`}
        action={
          <div className="flex items-center gap-2">
            {editing ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => { setDraft(letter.content); setSubject(letter.subject ?? ''); setEditing(false); setSaveError(''); }}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => setEditing(true)}
                >
                  Edit letter
                </button>
                <Link
                  href={`/jobs/${letter.jobId}`}
                  className="btn-secondary text-xs"
                  passHref
                >
                  Back to job
                </Link>
              </div>
            )}
          </div>
        }
      />

      {letter.thinInputs && (
        <div className="rounded-xl border border-warn/25 bg-warn/[0.05] p-4">
          <p className="text-sm text-ink">
            This letter was generated with limited information (a thin job
            description or profile). Review it carefully before sending — it
            may be more general than ideal.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-line p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            {letter.subject && (
              <p className="text-sm font-medium text-ink">{letter.subject}</p>
            )}
            <p className="muted text-xs uppercase tracking-widest mb-1">Version {letter.version}</p>
            <p className="muted text-xs">
              {letter.status.charAt(0) + letter.status.slice(1).toLowerCase()} ·{' '}
              {new Date(letter.updatedAt).toLocaleDateString()}
            </p>
          </div>
          <span
            className={`badge ${letter.status === 'GENERATED' ? 'bg-success/15 text-success-text' : 'bg-surface-sunken text-ink'}`}
          >
            {letter.status.charAt(0) + letter.status.slice(1).toLowerCase()}
          </span>
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="muted text-xs block mb-1">Subject line</label>
              <input
                className="input w-full"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Application for Backend Engineer"
              />
            </div>
            <div>
              <label className="muted text-xs block mb-1">Letter</label>
              <textarea
                className="input w-full h-96 font-serif leading-relaxed"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            {saveError && (
              <p className="text-xs text-danger-text">{saveError}</p>
            )}
          </div>
        ) : (
          <div className="prose prose-sm text-muted max-w-none">
            {letter.subject && <p className="font-medium mb-3">{letter.subject}</p>}
            {letter.content.split('\n\n').map((paragraph, i) => (
              <p key={i} className="mb-3 leading-relaxed">
                {paragraph}
              </p>
            ))}
            <p className="mt-4 text-xs text-muted">
              {letter.signOff ?? 'Sincerely,'}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  async function handleSave() {
    if (runningRef.current) return;
    runningRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await updateLetter(letterId, {
        title: letter.title,
        content: draft,
        subject: subject || null,
        salutation: letter.salutation,
        signOff: letter.signOff,
        status: letter.status,
      });
      setEditing(false);
      // Reload so the updated timestamp and version reflect the save.
      void load();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Could not save the cover letter.',
      );
    } finally {
      runningRef.current = false;
      setSaving(false);
    }
  }
}
