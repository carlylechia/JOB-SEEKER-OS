'use client';

/**
 * Career profile review.
 *
 * The rule the whole interface is built around: nothing is saved until the user
 * says so, and the user can say "no" to any individual field.
 *
 * Three ideas do the work:
 *
 *  - CONFIDENCE IS SHOWN, NOT ASSUMED. Every extracted item carries a visible
 *    status — supported, needs review, or suggested — and the supporting text
 *    is one click away. Colour is never the only signal; each state has a word.
 *
 *  - CONFLICTS ARE SHOWN, NOT RESOLVED. Where the profile already holds a
 *    different value, both are visible side by side and the user picks. The
 *    interface never decides for them.
 *
 *  - A PARTIAL SAVE IS A GOOD SAVE. Each section is confirmed independently, so
 *    accepting the roles does not force accepting an inferred skill.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader,
  X,
} from 'lucide-react';

import type { CareerExtraction } from '@/lib/resume/schema';
import type { ReviewSubmission } from '@/lib/resume/career-profile';
import { EVIDENCE_LABELS, type EvidenceBadgeProps } from './evidence-badge';

type BasicsRow = {
  field: string;
  label: string;
  current: string | null;
  candidate: string | null;
  conflict: boolean;
};

type ReviewResponse = {
  extraction: {
    id: string;
    resumeId: string;
    wasTruncated: boolean;
    model: string | null;
    completedAt: string | null;
  };
  resume: { id: string; fileName: string; format: string };
  data: CareerExtraction;
  review: { version: number; basics: BasicsRow[] };
  defaults: ReviewSubmission;
  reviewFlags: number;
  canApply: boolean;
};

type FieldKey = 'keep' | 'replace' | 'clear';

type Phase = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

export function CareerProfileReview({ extractionId }: { extractionId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [submission, setSubmission] = useState<ReviewSubmission | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/resume/intelligence/${extractionId}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(json.error?.message ?? 'We could not open that review.');
        }
        const json = (await res.json()) as ReviewResponse;
        if (cancelled) return;

        // Version comes from the server, not from anything the browser sends.
        setData(json);
        setSubmission({
          ...json.defaults,
          expectedProfileVersion: json.review.version,
        });
        setPhase('ready');
      } catch (error) {
        if (cancelled) return;
        setPhase('error');
        setMessage(error instanceof Error ? error.message : 'We could not open that review.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [extractionId]);

  const update = useCallback((mutate: (draft: ReviewSubmission) => ReviewSubmission) => {
    setSubmission((current) => (current ? mutate(current) : current));
  }, []);

  const confirmedCount = useMemo(() => {
    if (!submission) return 0;
    return (
      submission.workExperience.filter((e) => e.include).length +
      submission.education.filter((e) => e.include).length +
      submission.skills.filter((s) => s.include).length +
      submission.projects.filter((p) => p.include).length +
      submission.credentials.filter((c) => c.include).length
    );
  }, [submission]);

  async function save() {
    if (!submission || phase === 'saving') return;
    setPhase('saving');
    setMessage('');
    try {
      const res = await fetch(`/api/resume/intelligence/${extractionId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        setPhase('error');
        setMessage(json.error?.message ?? 'We could not save your career profile.');
        return;
      }
      // Cleared on success so a later failure cannot strand stale edits, and a
      // failure leaves the user's work on screen to retry.
      setPhase('saved');
      // Show the persisted profile immediately so the user can see that their
      // career profile was actually saved, rather than being left on the review.
      router.push('/career-profile');
    } catch {
      setPhase('error');
      setMessage('We could not reach the server. Your edits are still here — try again.');
    }
  }

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted" role="status">
        <Loader className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading your review…
      </div>
    );
  }

  if (phase === 'error' && !data) {
    return (
      <div className="card-pad space-y-4 text-center" role="alert">
        <AlertTriangle className="mx-auto h-8 w-8 text-warn" aria-hidden="true" />
        <p className="text-sm text-ink">{message}</p>
        <div className="flex justify-center gap-3">
          <Link href="/career-profile" className="btn-secondary text-xs">
            View saved profile
          </Link>
          <button type="button" className="btn-primary text-xs" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data || !submission) return null;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="card-pad space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="title">Review your career profile</h1>
            <p className="muted mt-1">
              We read <span className="font-medium text-ink">{data.resume.fileName}</span>. Check
              what it found, fix anything wrong, and save the parts you are happy with.
            </p>
          </div>
          {data.reviewFlags > 0 && (
            <p className="flex shrink-0 items-center gap-1.5 rounded-full border border-warn/25 bg-warn/[0.08] px-3 py-1 text-xs font-medium text-warn-text">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              {data.reviewFlags} to double-check
            </p>
          )}
        </div>

        {data.extraction.wasTruncated && (
          <p className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn/[0.07] px-3 py-2 text-xs text-ink">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-text" aria-hidden="true" />
            This resume was longer than we analyse in one pass, so later sections may be missing.
          </p>
        )}
      </header>

      {!data.canApply && (
        <div className="card-pad flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted">
            Your career profile is available on Pro. Your review is ready whenever you upgrade.
          </p>
          <Link href="/settings/billing" className="btn-primary text-xs">
            See Pro
          </Link>
        </div>
      )}

      {/* ── 1. Basic information ───────────────────────────────────────── */}
      <Section
        step={1}
        title="Basic information"
        description="Your profile already holds some of these. We never overwrite them — choose which to take from the resume."
      >
        <ul className="space-y-3">
          {data.review.basics.map((row) => {
            const choice = submission.basics.find((b) => b.field === row.field);
            const action: FieldKey = choice?.action ?? 'keep';
            return (
              <li key={row.field} className="rounded-xl border border-line bg-black/[0.02] px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{row.label}</p>
                    {action === 'keep' && row.current && (
                      <p className="mt-1 text-sm text-muted">
                        <span className="text-xs uppercase tracking-wide text-muted/70">Current</span>{' '}
                        {row.current}
                      </p>
                    )}
                    {row.candidate && (
                      <p className="mt-1 text-sm text-ink">
                        <span className="text-xs uppercase tracking-wide text-muted/70">
                          From resume
                        </span>{' '}
                        {row.candidate}
                      </p>
                    )}
                    {row.conflict && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-warn-text">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Different from your current profile — choose which to keep
                      </p>
                    )}
                    {!row.current && !row.candidate && (
                      <p className="mt-1 text-sm text-muted">Not found in this resume.</p>
                    )}
                  </div>

                  <fieldset className="flex shrink-0 gap-1" aria-label={`${row.label} action`}>
                    {(['keep', 'replace', 'clear'] as FieldKey[]).map((option) => (
                      <label
                        key={option}
                        className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                          action === option
                            ? 'border-accent bg-accent/20 text-ink'
                            : 'border-line text-muted hover:bg-black/[0.04]'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`basic-${row.field}`}
                          value={option}
                          checked={action === option}
                          className="sr-only"
                          onChange={() =>
                            update((draft) => ({
                              ...draft,
                              basics: draft.basics.map((b) =>
                                b.field === row.field
                                  ? { ...b, action: option, value: row.candidate }
                                  : b,
                              ),
                            }))
                          }
                        />
                        {option === 'keep' ? 'Keep' : option === 'replace' ? 'Use this' : 'Clear'}
                      </label>
                    ))}
                  </fieldset>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* ── 2. Work experience ─────────────────────────────────────────── */}
      <Section
        step={2}
        title="Work experience"
        description="Uncheck anything you do not want on your profile. Edit any field before saving."
      >
        {submission.workExperience.length === 0 ? (
          <EmptyNote text="No roles were found in this resume. You can still save the rest of your profile." />
        ) : (
          <ul className="space-y-3">
            {submission.workExperience.map((entry, index) => {
              const source = data.data.workExperience[index];
              const conflict = Boolean(source?.conflicts.length);
              return (
                <EntryRow
                  key={index}
                  checked={entry.include}
                  onToggle={(next) =>
                    update((draft) => ({
                      ...draft,
                      workExperience: draft.workExperience.map((item, i) =>
                        i === index ? { ...item, include: next } : item,
                      ),
                    }))
                  }
                  title={[entry.jobTitle, entry.company].filter(Boolean).join(' — ') || 'Untitled role'}
                  badge={source ? <EvidenceBadge level={source.evidence.level} /> : null}
                  conflict={conflict ? source!.conflicts : []}
                  evidence={source?.evidence ?? null}
                  evidenceKey={`experience-${index}`}
                  openEvidence={openEvidence}
                  setOpenEvidence={setOpenEvidence}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LabelledInput
                      label="Job title"
                      value={entry.jobTitle ?? ''}
                      onChange={(value) =>
                        update((draft) => ({
                          ...draft,
                          workExperience: draft.workExperience.map((item, i) =>
                            i === index ? { ...item, jobTitle: value } : item,
                          ),
                        }))
                      }
                    />
                    <LabelledInput
                      label="Company"
                      value={entry.company ?? ''}
                      onChange={(value) =>
                        update((draft) => ({
                          ...draft,
                          workExperience: draft.workExperience.map((item, i) =>
                            i === index ? { ...item, company: value } : item,
                          ),
                        }))
                      }
                    />
                    <LabelledInput
                      label="Start"
                      placeholder="YYYY-MM"
                      value={entry.startDate ?? ''}
                      onChange={(value) =>
                        update((draft) => ({
                          ...draft,
                          workExperience: draft.workExperience.map((item, i) =>
                            i === index ? { ...item, startDate: value } : item,
                          ),
                        }))
                      }
                    />
                    <LabelledInput
                      label="End"
                      placeholder="YYYY-MM or present"
                      value={entry.isCurrent ? 'present' : entry.endDate ?? ''}
                      onChange={(value) =>
                        update((draft) => ({
                          ...draft,
                          workExperience: draft.workExperience.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  endDate: value,
                                  isCurrent: value.toLowerCase() === 'present',
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                  </div>
                  <BulletEditor
                    label="Responsibilities"
                    items={entry.responsibilities}
                    onChange={(items) =>
                      update((draft) => ({
                        ...draft,
                        workExperience: draft.workExperience.map((item, i) =>
                          i === index ? { ...item, responsibilities: items } : item,
                        ),
                      }))
                    }
                  />
                  <BulletEditor
                    label="Achievements"
                    items={entry.achievements}
                    onChange={(items) =>
                      update((draft) => ({
                        ...draft,
                        workExperience: draft.workExperience.map((item, i) =>
                          i === index ? { ...item, achievements: items } : item,
                        ),
                      }))
                    }
                  />
                </EntryRow>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── 3. Education ───────────────────────────────────────────────── */}
      <Section step={3} title="Education" description="Only qualifications the resume actually lists.">
        {submission.education.length === 0 ? (
          <EmptyNote text="No education was found in this resume." />
        ) : (
          <ul className="space-y-3">
            {submission.education.map((entry, index) => {
              const source = data.data.education[index];
              return (
                <EntryRow
                  key={index}
                  checked={entry.include}
                  onToggle={(next) =>
                    update((draft) => ({
                      ...draft,
                      education: draft.education.map((item, i) =>
                        i === index ? { ...item, include: next } : item,
                      ),
                    }))
                  }
                  title={[entry.qualification, entry.fieldOfStudy, entry.institution]
                    .filter(Boolean)
                    .join(' — ') || 'Qualification'}
                  badge={source ? <EvidenceBadge level={source.evidence.level} /> : null}
                  evidence={source?.evidence ?? null}
                  evidenceKey={`education-${index}`}
                  openEvidence={openEvidence}
                  setOpenEvidence={setOpenEvidence}
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <LabelledInput
                      label="Institution"
                      value={entry.institution ?? ''}
                      onChange={(value) =>
                        update((draft) => ({
                          ...draft,
                          education: draft.education.map((item, i) =>
                            i === index ? { ...item, institution: value } : item,
                          ),
                        }))
                      }
                    />
                    <LabelledInput
                      label="Qualification"
                      value={entry.qualification ?? ''}
                      onChange={(value) =>
                        update((draft) => ({
                          ...draft,
                          education: draft.education.map((item, i) =>
                            i === index ? { ...item, qualification: value } : item,
                          ),
                        }))
                      }
                    />
                    <LabelledInput
                      label="Field of study"
                      value={entry.fieldOfStudy ?? ''}
                      onChange={(value) =>
                        update((draft) => ({
                          ...draft,
                          education: draft.education.map((item, i) =>
                            i === index ? { ...item, fieldOfStudy: value } : item,
                          ),
                        }))
                      }
                    />
                  </div>
                </EntryRow>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── 4. Skills ──────────────────────────────────────────────────── */}
      <Section
        step={4}
        title="Skills"
        description="Skills the resume states or backs with evidence are ticked. Inferred ones start unticked — add one only if you have it."
      >
        {submission.skills.length === 0 ? (
          <EmptyNote text="No skills were found in this resume." />
        ) : (
          <>
            <ul className="flex flex-wrap gap-2">
              {submission.skills.map((skill, index) => {
                const inferred = skill.origin === 'INFERRED';
                return (
                  <li key={`${skill.name}-${index}`}>
                    <label
                      className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        skill.include
                          ? 'border-accent bg-accent/20 text-ink'
                          : 'border-line text-muted hover:bg-black/[0.04]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={skill.include}
                        className="sr-only"
                        onChange={(event) =>
                          update((draft) => ({
                            ...draft,
                            skills: draft.skills.map((item, i) =>
                              i === index ? { ...item, include: event.target.checked } : item,
                            ),
                          }))
                        }
                      />
                      {skill.include ? (
                        <Check className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <X className="h-3 w-3 opacity-50" aria-hidden="true" />
                      )}
                      {skill.name}
                      <span className="text-[10px] uppercase tracking-wide opacity-70">
                        {inferred ? 'suggested' : skill.origin === 'STATED' ? 'stated' : 'from role'}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {submission.skills.filter((s) => s.origin === 'INFERRED').length} of these were
              inferred rather than stated, so they start off.
            </p>
          </>
        )}
      </Section>

      {/* ── 5. Projects ────────────────────────────────────────────────── */}
      <Section step={5} title="Projects" description="Personal and professional projects listed on the resume.">
        {submission.projects.length === 0 ? (
          <EmptyNote text="No projects were found in this resume." />
        ) : (
          <ul className="space-y-3">
            {submission.projects.map((project, index) => {
              const source = data.data.projects[index];
              return (
                <EntryRow
                  key={index}
                  checked={project.include}
                  onToggle={(next) =>
                    update((draft) => ({
                      ...draft,
                      projects: draft.projects.map((item, i) =>
                        i === index ? { ...item, include: next } : item,
                      ),
                    }))
                  }
                  title={project.name ?? 'Project'}
                  badge={source ? <EvidenceBadge level={source.evidence.level} /> : null}
                  evidence={source?.evidence ?? null}
                  evidenceKey={`project-${index}`}
                  openEvidence={openEvidence}
                  setOpenEvidence={setOpenEvidence}
                >
                  <LabelledInput
                    label="Description"
                    value={project.description ?? ''}
                    onChange={(value) =>
                      update((draft) => ({
                        ...draft,
                        projects: draft.projects.map((item, i) =>
                          i === index ? { ...item, description: value } : item,
                        ),
                      }))
                    }
                  />
                </EntryRow>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── 6. Certifications and other information ─────────────────────── */}
      <Section
        step={6}
        title="Certifications and other information"
        description="Certifications, licences, languages, awards, publications and volunteer work."
      >
        {submission.credentials.length === 0 ? (
          <EmptyNote text="Nothing in this section was found in the resume." />
        ) : (
          <ul className="space-y-3">
            {submission.credentials.map((credential, index) => {
              const source = data.data.credentials[index];
              return (
                <EntryRow
                  key={index}
                  checked={credential.include}
                  onToggle={(next) =>
                    update((draft) => ({
                      ...draft,
                      credentials: draft.credentials.map((item, i) =>
                        i === index ? { ...item, include: next } : item,
                      ),
                    }))
                  }
                  title={credential.name}
                  badge={source ? <EvidenceBadge level={source.evidence.level} /> : null}
                  evidence={source?.evidence ?? null}
                  evidenceKey={`credential-${index}`}
                  openEvidence={openEvidence}
                  setOpenEvidence={setOpenEvidence}
                >
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {CREDENTIAL_LABELS[credential.kind] ?? credential.kind}
                    {credential.proficiency ? ` · ${credential.proficiency}` : ''}
                  </p>
                </EntryRow>
              );
            })}
          </ul>
        )}
      </Section>

      {data.data.warnings.length > 0 && (
        <Section step={7} title="Worth knowing" description="Things we noticed while reading.">
          <ul className="space-y-2">
            {data.data.warnings.map((warning, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-muted">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn-text" aria-hidden="true" />
                {warning}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Save ───────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-10 border-t border-line bg-background/95 px-1 py-4 backdrop-blur">
        <p role="status" aria-live="polite" className="sr-only">
          {phase === 'saving' && 'Saving your career profile.'}
          {phase === 'saved' && 'Career profile saved.'}
          {phase === 'error' && message}
        </p>

        {phase === 'saved' ? (
          <div className="flex flex-wrap items-center gap-4">
            <p className="flex items-center gap-2 text-sm font-medium text-success-text">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Saved — {confirmedCount} item{confirmedCount === 1 ? '' : 's'} added to your career
              profile.
            </p>
            <Link href="/career-profile" className="btn-secondary text-xs">
              View saved profile
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={() => void save()}
              disabled={phase === 'saving' || !data.canApply}
            >
              {phase === 'saving' ? (
                <>
                  <Loader className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                `Save ${confirmedCount} confirmed item${confirmedCount === 1 ? '' : 's'}`
              )}
            </button>
            <p className="text-xs text-muted">
              Only ticked items are saved. Unticked ones are left out.
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm text-ink">{message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

const CREDENTIAL_LABELS: Record<string, string> = {
  CERTIFICATION: 'Certification',
  LICENSE: 'Licence',
  LANGUAGE: 'Language',
  AWARD: 'Award',
  PUBLICATION: 'Publication',
  VOLUNTEER: 'Volunteer work',
};

// ─── Presentational pieces ─────────────────────────────────────────────────

function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-pad" aria-labelledby={`section-${step}`}>
      <div className="mb-4">
        <h2 id={`section-${step}`} className="flex items-center gap-2 text-base font-semibold text-ink">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-warn-text"
          >
            {step}
          </span>
          {title}
        </h2>
        <p className="muted mt-1">{description}</p>
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{text}</p>;
}

type Evidence = { snippet: string | null; section: string | null; level: string };

function EntryRow({
  checked,
  onToggle,
  title,
  badge,
  conflict = [],
  evidence,
  evidenceKey,
  openEvidence,
  setOpenEvidence,
  children,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
  title: string;
  badge: React.ReactNode;
  conflict?: string[];
  evidence: Evidence | null;
  evidenceKey: string;
  openEvidence: string | null;
  setOpenEvidence: (key: string | null) => void;
  children?: React.ReactNode;
}) {
  const expanded = openEvidence === evidenceKey;
  return (
    <li
      className={`rounded-xl border px-4 py-3 transition-colors ${
        checked ? 'border-accent/40 bg-accent/[0.04]' : 'border-line bg-black/[0.02] opacity-70'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <label className="flex cursor-pointer items-center pt-0.5">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => onToggle(event.target.checked)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                checked ? 'border-accent bg-accent text-[#17191E]' : 'border-line bg-card'
              }`}
            >
              {checked && <Check className="h-3.5 w-3.5" />}
            </span>
            <span className="sr-only">{checked ? `Exclude ${title}` : `Include ${title}`}</span>
          </label>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">{badge}</div>
          </div>
        </div>

        {evidence?.snippet && (
          <button
            type="button"
            className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-muted hover:bg-black/[0.04] hover:text-ink"
            aria-expanded={expanded}
            onClick={() => setOpenEvidence(expanded ? null : evidenceKey)}
          >
            {expanded ? 'Hide evidence' : 'Show evidence'}
            <ChevronDown
              className={`ml-1 inline h-3 w-3 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {conflict.length > 0 && (
        <div className="mt-3 rounded-lg border border-warn/25 bg-warn/[0.07] px-3 py-2" role="note">
          <p className="flex items-start gap-1.5 text-xs font-medium text-warn-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            The resume contradicts itself here
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-ink">
            {conflict.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {expanded && evidence?.snippet && (
        <blockquote className="mt-3 border-l-2 border-accent bg-black/[0.03] px-3 py-2 text-xs italic text-muted">
          “{evidence.snippet}”
          {evidence.section && <span className="mt-1 block not-italic">— {evidence.section}</span>}
        </blockquote>
      )}

      {checked && children && <div className="mt-4 space-y-3">{children}</div>}
    </li>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = `field-${label.replace(/\s+/g, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function BulletEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const id = `bullets-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      <textarea
        id={id}
        className="input min-h-24 resize-y"
        value={items.join('\n')}
        placeholder="One per line"
        onChange={(event) =>
          onChange(
            event.target.value
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
          )
        }
      />
    </div>
  );
}

/** Re-exported so the badge styling stays in one place. */
function EvidenceBadge(props: EvidenceBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        props.level === 'SUPPORTED'
          ? 'bg-success/10 text-success-text'
          : props.level === 'SUGGESTED'
            ? 'bg-info/10 text-muted'
            : 'bg-warn/10 text-warn-text'
      }`}
    >
      <span aria-hidden="true">{props.level === 'SUPPORTED' ? '●' : props.level === 'SUGGESTED' ? '○' : '◐'}</span>
      {EVIDENCE_LABELS[props.level]}
    </span>
  );
}