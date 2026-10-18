'use client';

/**
 * Resume library client.
 *
 * Creating a resume is the one action here, so the interesting decision is what
 * it starts FROM:
 *
 *   - From my career profile — copies only values you have already confirmed.
 *     Nothing is inferred, and editing the result never changes your profile.
 *   - Blank — nothing at all, for the rare resume that is not about your
 *     confirmed history.
 *   - Duplicate — an independent copy of an existing resume, aimed at a
 *     different job. The original is never touched.
 *
 * The plan limit is shown before the button, not as a surprise after it. A limit
 * you only discover by hitting it is a bad limit.
 */

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, FilePlus2, Loader, Sparkles, Trash2 } from 'lucide-react';

import type { TargetableJob } from './types';

type Summary = {
  id: string;
  name: string;
  origin: string;
  targetJob: { id: string; title: string; company: string } | null;
  sourceResumeId: string | null;
  updatedAt: string;
  createdAt: string;
  hasContent: boolean;
};

type Props = {
  initialResumes: Summary[];
  careerProfile: {
    confirmed: boolean;
    version: number | null;
    counts: {
      experiences: number;
      education: number;
      skills: number;
      projects: number;
      credentials: number;
    };
  } | null;
  access: {
    canBuild: boolean;
    canOptimize: boolean;
    plan: string;
    isAdmin: boolean;
    isTrialing: boolean;
    resumeLimit: number | null;
    resumesUsed: number;
  };
};

type StartFrom = 'PROFILE' | 'BLANK' | 'DUPLICATE';

const ORIGIN_LABELS: Record<string, string> = {
  PROFILE: 'From your career profile',
  BLANK: 'Blank',
  DUPLICATE: 'Copied from another resume',
  OPTIMIZATION: 'Tailored for a job',
};

export function ResumeListClient({ initialResumes, careerProfile, access }: Props) {
  const router = useRouter();
  const [resumes, setResumes] = useState(initialResumes);
  const [startFrom, setStartFrom] = useState<StartFrom>(
    careerProfile?.confirmed ? 'PROFILE' : 'BLANK',
  );
  const [duplicateSource, setDuplicateSource] = useState(initialResumes[0]?.id ?? '');
  const [jobs, setJobs] = useState<TargetableJob[]>([]);
  const [targetJobId, setTargetJobId] = useState('');
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const inFlight = useRef(false);

  const loadJobs = useCallback(async () => {
    if (jobs.length > 0) return;
    try {
      const response = await fetch('/api/resumes/eligible-jobs', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { jobs: TargetableJob[] };
      setJobs(payload.jobs);
    } catch {
      // Targeting is optional; a failure here must not block creating a resume.
    }
  }, [jobs.length]);

  const create = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setCreating(true);
    setMessage('');

    try {
      const response = await fetch('/api/resumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          from: startFrom,
          sourceResumeId: startFrom === 'DUPLICATE' ? duplicateSource : undefined,
          targetJobId: targetJobId || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(
          (payload?.error?.message as string | undefined) ?? 'We could not create that resume.',
        );
        return;
      }
      router.push(`/resumes/${payload.resume.id}`);
    } catch {
      setMessage('We could not reach the server. Please try again.');
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  }, [startFrom, duplicateSource, targetJobId, router]);

  const remove = useCallback(async (id: string) => {
    const response = await fetch(`/api/resumes/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      setMessage('We could not delete that resume.');
      return;
    }
    setResumes((current) => current.filter((resume) => resume.id !== id));
    setPendingRemoval(null);
    router.refresh();
  }, [router]);

  const atLimit =
    access.resumeLimit !== null && access.resumesUsed >= access.resumeLimit;

  if (!access.canBuild) {
    return (
      <section className="card-pad space-y-3">
        <h2 className="text-base font-semibold text-ink">The resume builder is on Pro</h2>
        <p className="text-sm text-muted">
          Build one resume and tailor a version of it for every role you apply to. Your uploads,
          career profile, jobs and scoring all stay exactly where they are.
        </p>
        <Link href="/settings/billing" className="btn-primary">
          See plans
        </Link>
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="your-resumes" className="card-pad">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="your-resumes" className="text-base font-semibold text-ink">
            Your resumes
          </h2>
          <span className="text-xs text-muted">
            {access.resumesUsed}
            {access.resumeLimit === null ? '' : ` of ${access.resumeLimit}`}
          </span>
        </div>

        {resumes.length === 0 ? (
          <p className="muted py-6 text-center">
            No resumes yet. Create one on the right and it will open straight into the editor.
          </p>
        ) : (
          <ul className="space-y-2">
            {resumes.map((resume) => (
              <li
                key={resume.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/resumes/${resume.id}`}
                    className="block truncate text-sm font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {resume.name}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {ORIGIN_LABELS[resume.origin] ?? resume.origin}
                    {resume.targetJob ? ` · ${resume.targetJob.title} at ${resume.targetJob.company}` : ''}
                    {resume.hasContent ? '' : ' · empty'}
                  </p>
                </div>

                {pendingRemoval === resume.id ? (
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setPendingRemoval(null)}>
                      Keep
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: 'rgb(var(--danger))', color: '#fff' }}
                      onClick={() => void remove(resume.id)}
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-danger-text hover:bg-danger/10"
                    aria-label={`Delete ${resume.name}`}
                    onClick={() => setPendingRemoval(resume.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="create-resume" className="card-pad h-fit space-y-4">
        <h2 id="create-resume" className="text-base font-semibold text-ink">
          New resume
        </h2>

        {atLimit ? (
          <p className="rounded-xl border border-line bg-surface p-3 text-sm text-ink-2">
            Your plan includes {access.resumeLimit} resume{access.resumeLimit === 1 ? '' : 's'}. Delete
            one, or upgrade for more.
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="sr-only">What to start from</legend>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                startFrom === 'PROFILE' ? 'border-accent bg-accent/5' : 'border-line bg-surface'
              }`}
            >
              <input
                type="radio"
                name="start-from"
                className="mt-1 h-4 w-4 accent-[#D4AF37]"
                checked={startFrom === 'PROFILE'}
                disabled={!careerProfile?.confirmed}
                onChange={() => setStartFrom('PROFILE')}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Start from my career profile
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {careerProfile?.confirmed
                    ? `${careerProfile.counts.experiences} roles, ${careerProfile.counts.skills} skills, ${careerProfile.counts.education} qualifications. Only values you confirmed.`
                    : 'Confirm your career profile first and this becomes available.'}
                </span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                startFrom === 'BLANK' ? 'border-accent bg-accent/5' : 'border-line bg-surface'
              }`}
            >
              <input
                type="radio"
                name="start-from"
                className="mt-1 h-4 w-4 accent-[#D4AF37]"
                checked={startFrom === 'BLANK'}
                onChange={() => setStartFrom('BLANK')}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Start with a blank resume
                </span>
                <span className="mt-0.5 block text-xs text-muted">An empty document you fill in yourself.</span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                startFrom === 'DUPLICATE' ? 'border-accent bg-accent/5' : 'border-line bg-surface'
              }`}
            >
              <input
                type="radio"
                name="start-from"
                className="mt-1 h-4 w-4 accent-[#D4AF37]"
                checked={startFrom === 'DUPLICATE'}
                disabled={resumes.length === 0}
                onChange={() => setStartFrom('DUPLICATE')}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Duplicate an existing resume
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  An independent copy. The original is never changed.
                </span>
              </span>
            </label>

            {startFrom === 'DUPLICATE' ? (
              <select
                className="select"
                value={duplicateSource}
                aria-label="Resume to duplicate"
                onChange={(event) => setDuplicateSource(event.target.value)}
              >
                {resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.name}
                  </option>
                ))}
              </select>
            ) : null}
          </fieldset>
        )}

        <div>
          <label htmlFor="new-resume-target" className="mb-1 block text-xs font-medium text-ink-2">
            Tailor it to a job (optional)
          </label>
          <select
            id="new-resume-target"
            className="select"
            value={targetJobId}
            onFocus={() => void loadJobs()}
            onChange={(event) => setTargetJobId(event.target.value)}
          >
            <option value="">No specific job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} · {job.company}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            Only jobs in your own workspace. Import a public job first if you have not already.
          </p>
        </div>

        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => void create()}
          disabled={creating || atLimit || (startFrom === 'DUPLICATE' && !duplicateSource)}
        >
          {creating ? <Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Create resume
        </button>

        <p role="status" aria-live="polite" className="sr-only">
          {message}
        </p>
        {message ? <p className="text-sm text-danger-text">{message}</p> : null}
      </section>
    </div>
  );
}