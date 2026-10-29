'use client';

/**
 * One job's application kit.
 *
 * Everything a user needs to apply to one role lives here: the job facts, the
 * tailored resumes linked to it, every material already written for it, and a
 * composer that generates the next one from the same context.
 *
 * The workspace arrives server-rendered from an ownership-scoped loader, so the
 * first paint already has the real data and no private record is fetched by a
 * browser that has not been authorised. Mutations refresh the same bounded
 * payload rather than guessing at the new state locally.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import {
  APPLIED_STATUSES,
  LENGTH_LABELS,
  MATERIAL_TYPE_META,
  TONE_LABELS,
  lengthsFor,
  resolveLength,
  resolveTone,
  tonesFor,
  type MaterialLength,
  type MaterialType,
  type Tone,
} from '@/lib/application-materials/materials';
import type { MaterialResult } from '@/lib/application-materials/schema';
import {
  buildKitSteps,
  groupWorkspaceMaterials,
  jobStatusLabel,
  type ApplicationWorkspaceData,
  type WorkspaceMaterialSummary,
  type WorkspaceResumeSummary,
} from '@/lib/application-materials/workspace';

type Props = {
  initialWorkspace: ApplicationWorkspaceData;
};

type GeneratedDraft = {
  materialId: string;
  outcome: 'COMPLETED' | 'REUSED';
  result: MaterialResult;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  ARCHIVED: 'Archived',
};

const GENERATION_LABELS: Record<string, string> = {
  PROCESSING: 'Writing',
  COMPLETED: 'Written',
  FAILED: 'Failed',
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

/**
 * The earlier materials the service will send as continuity context: newest
 * first, one per type, excluding the type being generated. Mirrors the
 * server-side query so the composer can tell the truth about what it will use.
 */
function continuityMaterials(
  materials: WorkspaceMaterialSummary[],
  currentType: MaterialType,
): WorkspaceMaterialSummary[] {
  // Match the server exactly: filter first, read at most the newest 24 rows,
  // then keep one per type. Looking at the whole library here would promise
  // context the service never loads for a busy application.
  const eligible = materials
    .filter(
      (material) =>
        material.type !== currentType &&
        material.status !== 'ARCHIVED' &&
        material.generationStatus === 'COMPLETED',
    )
    .slice(0, 24);

  const seen = new Set<string>();
  const selected: WorkspaceMaterialSummary[] = [];
  for (const material of eligible) {
    if (seen.has(material.type)) continue;
    seen.add(material.type);
    selected.push(material);
    if (selected.length >= 5) break;
  }
  return selected;
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'READY'
      ? 'bg-success/15 text-success-text'
      : status === 'ARCHIVED'
        ? 'bg-surface-sunken text-muted'
        : 'bg-warn/15 text-warn-text';
  return <span className={`badge ${tone}`}>{STATUS_LABELS[status] ?? status}</span>;
}

function GenerationPill({ status }: { status: string }) {
  const tone =
    status === 'COMPLETED'
      ? 'bg-success/15 text-success-text'
      : status === 'FAILED'
        ? 'bg-danger/15 text-danger-text'
        : 'bg-surface-sunken text-ink-2';
  return (
    <span className={`badge ${tone}`}>
      {GENERATION_LABELS[status] ?? status.toLowerCase()}
    </span>
  );
}

export default function ApplicationKitWorkspace({ initialWorkspace }: Props) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [selectedType, setSelectedType] = useState<MaterialType | null>(null);
  const [tone, setTone] = useState<Tone>('PROFESSIONAL');
  const [length, setLength] = useState<MaterialLength>('STANDARD');
  const [resumeId, setResumeId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [conversation, setConversation] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [linkingResumeId, setLinkingResumeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [copying, setCopying] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const { job, materials, resumes, availability, summary } = workspace;
  const jobId = job.id;

  const groups = useMemo(() => groupWorkspaceMaterials(materials), [materials]);
  const steps = useMemo(
    () =>
      buildKitSteps({
        jobId,
        materials,
        resumes,
        hasApplied: summary.hasApplied,
        hasInterview: summary.hasInterview,
      }),
    [jobId, materials, resumes, summary.hasApplied, summary.hasInterview],
  );

  const groupedLatest = useMemo(() => {
    const map = new Map<MaterialType, WorkspaceMaterialSummary | null>();
    for (const group of groups) map.set(group.type, group.latest);
    return map;
  }, [groups]);

  const linkedResumes = useMemo(
    () =>
      resumes.filter(
        (resume) => resume.targetJobId === jobId || resume.usedByMaterials > 0,
      ),
    [resumes, jobId],
  );
  const unlinkedResumes = useMemo(
    () => resumes.filter((resume) => resume.targetJobId === null && resume.usedByMaterials === 0),
    [resumes],
  );
  const resumesTargetedElsewhere = useMemo(
    () =>
      resumes.filter(
        (resume) =>
          resume.targetJobId !== null &&
          resume.targetJobId !== jobId &&
          resume.usedByMaterials === 0,
      ),
    [resumes, jobId],
  );

  const preferredResumeId = useMemo(() => {
    const targeted = linkedResumes.find((resume) => resume.targetJobId === jobId);
    return targeted?.id ?? linkedResumes[0]?.id ?? '';
  }, [linkedResumes, jobId]);

  const activeMaterials = useMemo(
    () =>
      [...materials]
        .filter((material) => material.status !== 'ARCHIVED')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [materials],
  );
  const archivedMaterials = useMemo(
    () =>
      [...materials]
        .filter((material) => material.status === 'ARCHIVED')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [materials],
  );
  const timeline = showArchived ? [...activeMaterials, ...archivedMaterials] : activeMaterials;

  const selectedMeta = selectedType ? MATERIAL_TYPE_META[selectedType] : null;
  const selectedAvailability = selectedType ? availability[selectedType] : null;
  const selectedLatest = selectedType ? groupedLatest.get(selectedType) ?? null : null;
  const continuity = useMemo(
    () => (selectedType ? continuityMaterials(materials, selectedType) : []),
    [materials, selectedType],
  );

  // A thank-you with neither a recorded interview nor the user's own notes has
  // nothing real to refer to. The server refuses it; disable the action here so
  // the composer explains the missing input before a provider call is attempted.
  const missingThankYouNotes =
    selectedType === 'INTERVIEW_THANK_YOU' &&
    job.interviews.length === 0 &&
    !conversation.trim();

  const canGenerate =
    Boolean(selectedType) &&
    Boolean(selectedAvailability?.canGenerate) &&
    !missingThankYouNotes &&
    !generating;

  const refreshWorkspace = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/application-materials/workspace/${jobId}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'Could not refresh this application kit.');
      }
      if (payload?.workspace) setWorkspace(payload.workspace as ApplicationWorkspaceData);
    } finally {
      setRefreshing(false);
    }
  }, [jobId]);

  const chooseType = useCallback(
    (type: MaterialType) => {
      setSelectedType(type);
      setTone((current) => resolveTone(type, current));
      setLength((current) => resolveLength(type, current));
      setResumeId((current) => current || preferredResumeId);
      setInstructions('');
      setConversation('');
      setRecipientName('');
      setDraft(null);
      setError(null);
      setNotice(null);
    },
    [preferredResumeId],
  );

  const generate = useCallback(async () => {
    if (
      !selectedType ||
      !selectedAvailability?.canGenerate ||
      (selectedType === 'INTERVIEW_THANK_YOU' &&
        job.interviews.length === 0 &&
        !conversation.trim())
    ) {
      return;
    }
    setGenerating(true);
    setError(null);
    setNotice(null);
    setDraft(null);

    try {
      const response = await fetch('/api/application-materials/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          type: selectedType,
          jobId,
          resumeId: resumeId || null,
          tone,
          length,
          instructions: instructions.trim() || undefined,
          conversation: conversation.trim() || undefined,
          recipientName: recipientName.trim() || undefined,
          // An explicit click in the kit means "write another one". Reuse is
          // still the server's default, so only bypass it when a draft of this
          // type already exists.
          force: Boolean(selectedLatest),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = payload?.error?.code;
        if (code === 'PLAN_REQUIRED') {
          setError(
            payload.error.message ??
              'AI application materials are available on Pro. Your saved drafts are unchanged.',
          );
        } else {
          setError(payload?.error?.message ?? 'Generation failed. Please try again.');
        }
        return;
      }

      const nextDraft: GeneratedDraft = {
        materialId: payload.materialId,
        outcome: payload.outcome === 'REUSED' ? 'REUSED' : 'COMPLETED',
        result: payload.result as MaterialResult,
      };
      setDraft(nextDraft);
      setNotice(
        nextDraft.outcome === 'REUSED'
          ? 'An existing draft already matched these choices, so it was opened without spending a credit.'
          : 'Draft ready. Review it before you copy or download it.',
      );
      try {
        await refreshWorkspace();
      } catch {
        // The draft itself succeeded; failing to re-read the kit must not look
        // like a generation failure and tempt the user into paying twice.
        setNotice(
          'Draft ready. The kit timeline could not refresh, so reload the page to see it there.',
        );
      }
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch {
      setError('Generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [
    selectedType,
    selectedAvailability,
    selectedLatest,
    jobId,
    job.interviews.length,
    resumeId,
    tone,
    length,
    instructions,
    conversation,
    recipientName,
    refreshWorkspace,
  ]);

  const linkResume = useCallback(
    async (resume: WorkspaceResumeSummary) => {
      setLinkingResumeId(resume.id);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(`/api/resumes/${resume.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            expectedRevision: resume.revision,
            targetJobId: jobId,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (payload?.error?.code === 'CONFLICT') {
            setError('That resume changed in another tab. Refresh this page and try again.');
          } else {
            setError(payload?.error?.message ?? 'Could not link that resume to this role.');
          }
          return;
        }
        setNotice(`“${resume.name}” is now linked to this role.`);
        setResumeId(resume.id);
        await refreshWorkspace();
      } catch {
        setError('Could not link that resume to this role.');
      } finally {
        setLinkingResumeId(null);
      }
    },
    [jobId, refreshWorkspace],
  );

  const unlinkResume = useCallback(
    async (resume: WorkspaceResumeSummary) => {
      setLinkingResumeId(resume.id);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(`/api/resumes/${resume.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            expectedRevision: resume.revision,
            targetJobId: null,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(payload?.error?.message ?? 'Could not unlink that resume.');
          return;
        }
        setNotice(`“${resume.name}” is no longer the tailored resume for this role.`);
        await refreshWorkspace();
      } catch {
        setError('Could not unlink that resume.');
      } finally {
        setLinkingResumeId(null);
      }
    },
    [refreshWorkspace],
  );

  const copyDraft = useCallback(async () => {
    if (!draft) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(draft.result.content);
      setNotice('Draft copied to your clipboard.');
    } catch {
      setError('Could not copy this draft. Open it in the editor to copy it there.');
    } finally {
      setTimeout(() => setCopying(false), 1200);
    }
  }, [draft]);

  const selectedJobStatusApplied =
    APPLIED_STATUSES.includes(job.status) || job.dateApplied !== null || job.nextFollowUp !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={job.title}
        subtitle={`${job.company}${job.location ? ` · ${job.location}` : ''}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={`/jobs/${job.id}`} className="btn-secondary text-xs">
              ← Back to job
            </Link>
            <Link href="/application-materials" className="btn-secondary text-xs">
              Application library
            </Link>
            <Link
              href={`/application-materials/new?job=${job.id}`}
              className="btn-primary text-xs"
            >
              Open full editor
            </Link>
          </div>
        }
      />

      {/* Application facts the kit is allowed to use. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="badge bg-surface-sunken text-ink-2">{jobStatusLabel(job.status)}</span>
        <span className="badge bg-surface-sunken text-ink-2">{job.remoteType || 'Work arrangement not set'}</span>
        {selectedJobStatusApplied ? (
          <span className="badge bg-success/15 text-success-text">Application recorded</span>
        ) : (
          <span className="badge bg-warn/15 text-warn-text">Not marked applied</span>
        )}
        {summary.hasInterview ? (
          <span className="badge bg-success/15 text-success-text">
            {plural(job.interviews.length, 'interview')} recorded
          </span>
        ) : (
          <span className="badge bg-surface-sunken text-ink-2">No interview recorded</span>
        )}
        {refreshing ? <span className="muted animate-pulse">Refreshing…</span> : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-sm text-danger-text"
        >
          <span>{error}</span>
          <button type="button" className="btn-secondary text-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="rounded-xl border border-success/25 bg-success/[0.08] px-4 py-3 text-sm text-success-text"
        >
          {notice}
        </div>
      ) : null}

      {/* Kit progress */}
      <section className="card-pad" aria-labelledby="kit-progress-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="kit-progress-heading" className="text-sm font-semibold text-ink">
              Application kit progress
            </h2>
            <p className="muted mt-1 text-xs">
              {plural(summary.activeMaterials, 'material')} · {plural(summary.readyCount, 'ready draft')} ·{' '}
              {plural(summary.resumeCount, 'linked resume')}
            </p>
          </div>
          {summary.archivedCount > 0 ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived ? 'Hide archived' : `${summary.archivedCount} archived`}
            </button>
          ) : null}
        </div>

        <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((step, index) => (
            <li
              key={step.key}
              className={`rounded-xl border p-3 ${
                step.complete
                  ? 'border-success/25 bg-success/[0.06]'
                  : 'border-line bg-surface-sunken'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    step.complete
                      ? 'bg-success text-white'
                      : 'bg-card text-muted ring-1 ring-line'
                  }`}
                >
                  {step.complete ? '✓' : index + 1}
                </span>
                <span className="text-sm font-medium text-ink">{step.label}</span>
              </div>
              <p className="muted mt-2 text-xs">{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          {/* Material type picker */}
          <section className="card-pad" aria-labelledby="material-types-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="material-types-heading" className="text-lg font-semibold text-ink">
                Write something for this role
              </h2>
              <span className="muted text-xs">Everything stays a draft.</span>
            </div>
            <p className="muted mt-1 text-sm">
              Pick a type. The next draft uses this job, your profile, any linked resume and the
              materials you have already written for this application.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {groups.map((group) => {
                const groupAvailability = availability[group.type];
                const latest = group.latest;
                const active = selectedType === group.type;
                return (
                  <button
                    key={group.type}
                    type="button"
                    aria-pressed={active}
                    onClick={() => chooseType(group.type)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-accent bg-accent/[0.06]'
                        : 'border-line hover:border-line-strong hover:bg-surface-sunken'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{group.label}</span>
                      {latest ? (
                        <StatusPill status={latest.status} />
                      ) : (
                        <span className="badge bg-surface-sunken text-muted">Not started</span>
                      )}
                    </div>
                    <p className="muted mt-1 text-xs">{group.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted">
                        {group.activeCount > 0
                          ? plural(group.activeCount, 'draft')
                          : 'Nothing written yet'}
                      </span>
                      {!groupAvailability.canGenerate ? (
                        <span className="badge bg-warn/15 text-warn-text">Locked</span>
                      ) : null}
                      {groupAvailability.note ? (
                        <span className="badge bg-surface-sunken text-ink-2">Tip</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Composer */}
          {selectedType && selectedMeta && selectedAvailability ? (
            <section className="card-pad space-y-4" aria-labelledby="composer-heading">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 id="composer-heading" className="text-lg font-semibold text-ink">
                    {selectedMeta.label}
                  </h2>
                  <p className="muted mt-1 text-sm">{selectedMeta.description}</p>
                </div>
                {selectedLatest ? (
                  <Link
                    href={`/application-materials/${selectedLatest.id}`}
                    className="btn-secondary text-xs"
                  >
                    Open latest draft
                  </Link>
                ) : null}
              </div>

              {!selectedAvailability.canGenerate ? (
                <div className="rounded-xl border border-warn/25 bg-warn/[0.07] p-3 text-sm text-warn-text">
                  <p className="font-medium">This one is not honest yet.</p>
                  <p className="mt-1">{selectedAvailability.reason}</p>
                  {!selectedJobStatusApplied ? (
                    <Link
                      href={`/jobs/${job.id}`}
                      className="mt-2 inline-block text-xs underline underline-offset-2"
                    >
                      Update the pipeline status
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {selectedAvailability.note && selectedAvailability.canGenerate ? (
                <p className="rounded-xl border border-line bg-surface-sunken p-3 text-xs text-ink-2">
                  {selectedAvailability.note}
                </p>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <span className="mb-1 block text-sm font-medium text-ink">Tone</span>
                  <div className="flex flex-wrap gap-1">
                    {tonesFor(selectedType).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={tone === option}
                        onClick={() => setTone(option)}
                        className={`rounded-xl border px-3 py-1.5 text-xs transition-colors ${
                          tone === option
                            ? 'border-accent bg-accent/[0.06] font-medium text-ink'
                            : 'border-line text-ink-2 hover:border-line-strong'
                        }`}
                      >
                        {TONE_LABELS[option]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="mb-1 block text-sm font-medium text-ink">Length</span>
                  <div className="flex flex-wrap gap-1">
                    {lengthsFor(selectedType).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={length === option}
                        onClick={() => setLength(option)}
                        className={`rounded-xl border px-3 py-1.5 text-xs transition-colors ${
                          length === option
                            ? 'border-accent bg-accent/[0.06] font-medium text-ink'
                            : 'border-line text-ink-2 hover:border-line-strong'
                        }`}
                      >
                        {LENGTH_LABELS[option]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-ink" htmlFor="kit-resume">
                    Resume to use
                  </label>
                  <select
                    id="kit-resume"
                    className="input"
                    value={resumeId}
                    onChange={(event) => setResumeId(event.target.value)}
                  >
                    <option value="">Use my confirmed career profile</option>
                    {linkedResumes.length > 0 ? (
                      <optgroup label="Linked to this role">
                        {linkedResumes.map((resume) => (
                          <option key={resume.id} value={resume.id}>
                            {resume.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {unlinkedResumes.length > 0 ? (
                      <optgroup label="Other resumes">
                        {unlinkedResumes.map((resume) => (
                          <option key={resume.id} value={resume.id}>
                            {resume.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  <p className="muted mt-1 text-xs">
                    A selected resume is additional evidence. It never overrides your confirmed
                    profile.
                  </p>
                </div>

                {selectedMeta.fields.includes('RECIPIENT_NAME') ? (
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-ink" htmlFor="kit-recipient">
                      Recipient name (optional)
                    </label>
                    <input
                      id="kit-recipient"
                      className="input"
                      value={recipientName}
                      onChange={(event) => setRecipientName(event.target.value)}
                      placeholder="Only a name you actually know from a saved contact"
                      maxLength={120}
                    />
                  </div>
                ) : null}

                {selectedMeta.fields.includes('INTERVIEW_NOTES') ? (
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-ink" htmlFor="kit-notes">
                      What did you actually discuss? (optional)
                    </label>
                    <textarea
                      id="kit-notes"
                      className="input min-h-[90px] resize-y"
                      value={conversation}
                      onChange={(event) => setConversation(event.target.value)}
                      placeholder="The interviewer, the topics, anything you want to refer to. Only what really happened."
                      maxLength={4000}
                    />
                    <p className="muted mt-1 text-xs">
                      {job.interviews.length > 0
                        ? 'The recorded interview is already part of the context.'
                        : 'No interview is recorded. These notes are required before a thank-you can be written.'}
                    </p>
                  </div>
                ) : selectedMeta.fields.includes('CONVERSATION') ||
                  selectedMeta.fields.includes('SHARED_CONTEXT') ? (
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-ink" htmlFor="kit-context">
                      Real context from your exchange (optional)
                    </label>
                    <textarea
                      id="kit-context"
                      className="input min-h-[80px] resize-y"
                      value={conversation}
                      onChange={(event) => setConversation(event.target.value)}
                      placeholder="What actually happened, in your own words. Never invented."
                      maxLength={4000}
                    />
                  </div>
                ) : null}

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-ink" htmlFor="kit-instructions">
                    Style guidance (optional)
                  </label>
                  <textarea
                    id="kit-instructions"
                    className="input min-h-[90px] resize-y"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder="e.g. Emphasise the platform work and keep the opening short."
                    maxLength={2000}
                  />
                  <p className="muted mt-1 text-xs">
                    Guidance changes wording and emphasis. It cannot add a fact to your record.
                  </p>
                </div>
              </div>

              {continuity.length > 0 ? (
                <div className="rounded-xl border border-line bg-surface-sunken p-3">
                  <p className="text-xs font-medium text-ink">Continuity context</p>
                  <p className="muted mt-1 text-xs">
                    This draft will keep the same voice as {plural(continuity.length, 'earlier material')}{' '}
                    for this application:
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {continuity.map((material) => (
                      <span key={material.id} className="badge bg-card text-ink-2 ring-1 ring-line">
                        {MATERIAL_TYPE_META[material.type as MaterialType]?.label ?? material.type}
                      </span>
                    ))}
                  </div>
                  <p className="muted mt-2 text-xs">
                    Earlier drafts are used for voice only. They are never treated as evidence about
                    you.
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canGenerate}
                  onClick={() => void generate()}
                  aria-describedby="kit-generate-note"
                >
                  {generating
                    ? 'Writing the draft…'
                    : selectedLatest
                      ? 'Write another draft'
                      : 'Generate draft'}
                </button>
                <span id="kit-generate-note" className="muted text-xs">
                  One AI credit per new draft. Existing drafts are reused for free.
                </span>
              </div>

              {missingThankYouNotes ? (
                <p className="text-xs text-warn-text">
                  Add what you actually discussed above, or record the interview in the job, to
                  enable this note.
                </p>
              ) : null}

              {generating ? (
                <p className="muted text-xs" aria-live="polite">
                  This calls the AI provider once. Nothing is sent to the employer.
                </p>
              ) : null}
            </section>
          ) : null}

          {/* Generated draft */}
          {draft ? (
            <section
              ref={resultRef}
              className="card-pad space-y-4 scroll-mt-6"
              aria-labelledby="kit-draft-heading"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 id="kit-draft-heading" className="text-lg font-semibold text-ink">
                    Your draft
                  </h2>
                  <p className="muted mt-1 text-xs">
                    Written for {job.title} at {job.company}. Nothing has been sent.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => void copyDraft()}
                    disabled={copying}
                  >
                    {copying ? 'Copied!' : 'Copy'}
                  </button>
                  <Link
                    href={`/application-materials/${draft.materialId}`}
                    className="btn-primary text-xs"
                  >
                    Review &amp; edit
                  </Link>
                </div>
              </div>

              {draft.result.subject ? (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                    Subject
                  </div>
                  <p className="rounded-xl border border-line bg-surface-sunken p-3 text-sm text-ink">
                    {draft.result.subject}
                  </p>
                </div>
              ) : null}

              <div className="max-h-96 overflow-auto rounded-xl border border-line bg-card p-4 text-sm leading-relaxed text-ink whitespace-pre-wrap">
                {draft.result.content}
              </div>

              {draft.result.warnings.length > 0 ? (
                <div className="rounded-xl border border-warn/25 bg-warn/[0.06] p-3">
                  <p className="text-xs font-medium text-warn-text">Check before sending</p>
                  <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-ink-2">
                    {draft.result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {draft.result.unsupported.length > 0 ? (
                <div className="rounded-xl border border-warn/25 bg-warn/[0.06] p-3">
                  <p className="text-xs font-medium text-warn-text">
                    Not supported by your records
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-ink-2">
                    {draft.result.unsupported.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {draft.result.missingInformation.length > 0 ? (
                <div className="rounded-xl border border-accent/25 bg-accent/[0.04] p-3">
                  <p className="text-xs font-medium text-accent-text">
                    Would make the next draft better
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-ink-2">
                    {draft.result.missingInformation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* History */}
          <section className="card-pad" aria-labelledby="kit-history-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="kit-history-heading" className="text-lg font-semibold text-ink">
                Materials for this role
              </h2>
              <span className="muted text-xs">{plural(timeline.length, 'item')}</span>
            </div>

            {timeline.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-line p-8 text-center">
                <p className="text-sm font-medium text-ink">Nothing written yet.</p>
                <p className="muted mt-1 text-xs">
                  Start with a cover letter, or link a tailored resume above.
                </p>
              </div>
            ) : (
              <ol className="mt-4 space-y-2">
                {timeline.map((material) => (
                  <li
                    key={material.id}
                    className="rounded-xl border border-line bg-card p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/application-materials/${material.id}`}
                          className="block truncate text-sm font-medium text-ink hover:text-accent-text"
                        >
                          {material.title}
                        </Link>
                        <p className="muted mt-1 text-xs">
                          {MATERIAL_TYPE_META[material.type as MaterialType]?.label ?? material.type}
                          {material.resumeName ? ` · ${material.resumeName}` : ''} · updated{' '}
                          {formatDate(material.updatedAt)}
                          {material.revision > 1 ? ` · revision ${material.revision}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={material.status} />
                        <GenerationPill status={material.generationStatus} />
                        <Link
                          href={`/application-materials/${material.id}`}
                          className="btn-secondary text-xs"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                    {material.status === 'DRAFT' && material.thinInputs ? (
                      <p className="mt-2 text-xs text-warn-text">
                        This draft was written from limited job details. Add more context and try
                        again.
                      </p>
                    ) : null}
                    {material.generationStatus === 'FAILED' ? (
                      <p className="mt-2 text-xs text-danger-text">
                        The last attempt did not finish
                        {material.errorCode ? ` (${material.errorCode.toLowerCase().replace(/_/g, ' ')})` : ''}.
                        Try again from the composer above.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Resumes */}
          <section className="card-pad" aria-labelledby="kit-resumes-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="kit-resumes-heading" className="text-lg font-semibold text-ink">
                Resumes for this role
              </h2>
              <Link href="/resumes" className="text-xs text-accent-text underline underline-offset-2">
                All resumes
              </Link>
            </div>

            {linkedResumes.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {linkedResumes.map((resume) => (
                  <li key={resume.id} className="rounded-xl border border-line bg-surface-sunken p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/resumes/${resume.id}`}
                          className="block truncate text-sm font-medium text-ink hover:text-accent-text"
                        >
                          {resume.name}
                        </Link>
                        <p className="muted mt-1 text-xs">
                          {resume.targetJobId === jobId
                            ? 'Tailored for this role'
                            : `Used by ${plural(resume.usedByMaterials, 'draft')}`}
                          {' · '}revision {resume.revision}
                        </p>
                      </div>
                      {resume.targetJobId === jobId ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={linkingResumeId !== null}
                          onClick={() => void unlinkResume(resume)}
                        >
                          {linkingResumeId === resume.id ? '…' : 'Unlink'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted mt-3 text-sm">
                No resume is linked yet. Link one below, or{' '}
                <Link href="/resumes" className="underline underline-offset-2">
                  build a tailored resume
                </Link>
                .
              </p>
            )}

            {unlinkedResumes.length > 0 ? (
              <div className="mt-4">
                <span className="mb-1 block text-xs font-medium text-muted">
                  Link an existing resume
                </span>
                <LinkResumeButton
                  resumes={unlinkedResumes}
                  busy={linkingResumeId !== null}
                  onLink={linkResume}
                />
              </div>
            ) : null}

            {resumesTargetedElsewhere.length > 0 ? (
              <p className="muted mt-3 text-xs">
                {plural(resumesTargetedElsewhere.length, 'resume')} already{' '}
                {resumesTargetedElsewhere.length === 1 ? 'is' : 'are'} tailored to another role.
                Duplicate one from the resumes page if you want a variant for this job.
              </p>
            ) : null}
          </section>

          {/* Application facts */}
          <section className="card-pad" aria-labelledby="kit-facts-heading">
            <h2 id="kit-facts-heading" className="text-lg font-semibold text-ink">
              What this draft can rely on
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Pipeline status</dt>
                <dd className="text-right text-ink">{jobStatusLabel(job.status)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Applied</dt>
                <dd className="text-right text-ink">
                  {job.dateApplied ? formatDate(job.dateApplied) : 'Not recorded'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Next follow-up</dt>
                <dd className="text-right text-ink">
                  {job.nextFollowUp ? formatDate(job.nextFollowUp) : 'Not set'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Job description</dt>
                <dd className="text-right text-ink">
                  {job.hasDescription ? 'Available' : 'Missing'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Contacts</dt>
                <dd className="text-right text-ink">{plural(job.contacts.length, 'contact')}</dd>
              </div>
            </dl>

            {job.interviews.length > 0 ? (
              <div className="mt-4 rounded-xl border border-line bg-surface-sunken p-3">
                <p className="text-xs font-medium text-ink">Recorded interviews</p>
                <ul className="mt-1 space-y-1 text-xs text-ink-2">
                  {job.interviews.map((interview) => (
                    <li key={`${interview.scheduledAt}-${interview.stage}`}>
                      {formatDate(interview.scheduledAt)} ·{' '}
                      {interview.type || interview.stage || 'Interview'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {job.contacts.length > 0 ? (
              <div className="mt-4 rounded-xl border border-line bg-surface-sunken p-3">
                <p className="text-xs font-medium text-ink">Saved contacts</p>
                <ul className="mt-1 space-y-1 text-xs text-ink-2">
                  {job.contacts.map((contact) => (
                    <li key={`${contact.name}-${contact.title}`}>
                      {contact.name}
                      {contact.title ? ` · ${contact.title}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Link
              href={`/jobs/${job.id}`}
              className="mt-4 inline-block text-xs text-accent-text underline underline-offset-2"
            >
              Edit the job facts
            </Link>
          </section>

          {/* Trust */}
          <section className="card-pad" aria-labelledby="kit-trust-heading">
            <h2 id="kit-trust-heading" className="text-lg font-semibold text-ink">
              How this stays honest
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-2">
              <li>Only your own profile, this job and your own earlier drafts are used.</li>
              <li>Every personal claim is checked against your records before it is saved.</li>
              <li>Numbers, employers and qualifications that cannot be verified are removed.</li>
              <li>Nothing is emailed, submitted or sent anywhere. Only you can send it.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * A small bridge between the select and the async link action.
 *
 * Keeping the select local to this component means the workspace does not rerender
 * on every keystroke, and the link button always acts on the value the user can
 * currently see.
 */
function LinkResumeButton({
  resumes,
  busy,
  onLink,
}: {
  resumes: WorkspaceResumeSummary[];
  busy: boolean;
  onLink: (resume: WorkspaceResumeSummary) => Promise<void>;
}) {
  const [resumeId, setResumeId] = useState('');
  return (
    <div className="flex gap-2">
      <select
        className="input"
        value={resumeId}
        onChange={(event) => setResumeId(event.target.value)}
        aria-label="Resume to link"
      >
        <option value="">Choose a resume…</option>
        {resumes.map((resume) => (
          <option key={resume.id} value={resume.id}>
            {resume.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn-secondary whitespace-nowrap text-xs"
        disabled={!resumeId || busy}
        onClick={() => {
          const resume = resumes.find((item) => item.id === resumeId);
          if (resume) void onLink(resume);
        }}
      >
        {busy ? 'Linking…' : 'Link'}
      </button>
    </div>
  );
}
