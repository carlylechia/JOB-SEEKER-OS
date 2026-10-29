'use client';

/**
 * Material editor.
 *
 * Handles creating a new draft and reviewing an existing one. Generation and
 * revision are explicit user actions; nothing is sent externally.
 *
 * A material belongs to the application kit for the job it targets. Editing a
 * saved draft therefore keeps its job and resume fixed, and "ask for a
 * revision" creates a new row chained through `supersedesId` instead of
 * overwriting the draft the user already reviewed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { ResumeLayoutPreview } from '@/components/resume-builder/resume-layout-preview';
import type { LayoutDocument } from '@/lib/resume-builder/layout';
import {
  MATERIAL_TYPES,
  isMaterialType,
  type MaterialType,
  type MaterialLength,
  type Tone,
  MATERIAL_TYPE_META,
  tonesFor,
  lengthsFor,
  resolveTone,
  resolveLength,
  TONE_LABELS,
  LENGTH_LABELS,
} from '@/lib/application-materials/materials';

type JobOption = { id: string; title: string; company: string; status: string };
type ResumeOption = { id: string; name: string };

type StoredMaterialResult = {
  meta?: { tone?: unknown; length?: unknown };
  greeting?: string;
  senderName?: string;
  signOff?: string;
  warnings?: string[];
  missingInformation?: string[];
  unsupported?: string[];
  claims?: Array<{ source: string; claim: string; status: string; note: string | null }>;
};

type FormValues = {
  type: MaterialType;
  jobId: string | null;
  resumeId: string | null;
  tone: Tone;
  length: MaterialLength;
  instructions: string;
  recipientName: string;
  conversation: string;
};

const DEFAULT_TYPE: MaterialType = 'COVER_LETTER';

/** Read a short opaque id from the URL without trusting it. */
function queryId(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

function queryType(value: string | null): MaterialType {
  return isMaterialType(value) ? value : DEFAULT_TYPE;
}

async function fetchJobs(): Promise<JobOption[]> {
  const res = await fetch('/api/bootstrap', { cache: 'no-store' });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({}));
  const jobs = Array.isArray(json.jobs) ? json.jobs : [];
  return jobs
    .filter((j: { id: string; title: string; company: string; status: string }) => Boolean(j.id))
    .map((j: { id: string; title: string; company: string; status: string }) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      status: j.status,
    }));
}

async function fetchResumes(): Promise<ResumeOption[]> {
  const res = await fetch('/api/resumes', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load your saved resumes.');
  const json = await res.json();
  return Array.isArray(json.resumes)
    ? json.resumes.filter(
        (resume: unknown): resume is ResumeOption =>
          typeof resume === 'object' &&
          resume !== null &&
          typeof (resume as ResumeOption).id === 'string' &&
          typeof (resume as ResumeOption).name === 'string',
      )
    : [];
}

export default function MaterialEditor() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeParams = useParams<{ id?: string }>();
  const materialIdFromUrl =
    (typeof routeParams?.id === 'string' && routeParams.id) || searchParams.get('id') || null;
  const mode: 'create' | 'edit' = materialIdFromUrl ? 'edit' : 'create';
  const revisionCreated = searchParams.get('revised') === '1';

  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [resumesLoading, setResumesLoading] = useState(true);
  const [resumeLoadError, setResumeLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormValues>(() => {
    const type = queryType(searchParams.get('type'));
    return {
      type,
      jobId: queryId(searchParams.get('job')),
      resumeId: queryId(searchParams.get('resume')),
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: '',
      recipientName: '',
      conversation: '',
    };
  });

  const [generating, setGenerating] = useState(false);
  const [revising, setRevising] = useState(false);
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    content: string;
    subject: string | null;
    greeting: string;
    senderName: string;
    signOff: string;
    warnings: string[];
    missingInformation: string[];
    unsupported: string[];
    claims: Array<{ source: string; claim: string; status: string; note: string | null }>;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [previewLayout, setPreviewLayout] = useState<LayoutDocument | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [materialLoading, setMaterialLoading] = useState(Boolean(materialIdFromUrl));
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState(1);

  const toneOptions = useMemo(() => tonesFor(form.type), [form.type]);
  const lengthOptions = useMemo(() => lengthsFor(form.type), [form.type]);
  const meta = MATERIAL_TYPE_META[form.type];
  const isApplicationGrounded =
    form.type === 'APPLICATION_FOLLOW_UP' ||
    form.type === 'APPLICATION_STATUS_CHECK' ||
    form.type === 'INTERVIEW_THANK_YOU';
  const supportsJob = Boolean(meta?.fields.includes('JOB'));
  const supportsPdf = Boolean(meta?.supportsPdf);
  const showInterviewNotes = Boolean(meta?.fields.includes('INTERVIEW_NOTES'));
  const showSharedContext =
    !showInterviewNotes &&
    (meta?.fields.includes('CONVERSATION') || meta?.fields.includes('SHARED_CONTEXT'));
  const showRecipient =
    meta?.fields.includes('RECIPIENT_NAME') || meta?.fields.includes('CONTACT');

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === form.jobId) ?? null,
    [jobs, form.jobId],
  );
  const selectedResume = useMemo(
    () => resumes.find((resume) => resume.id === form.resumeId) ?? null,
    [resumes, form.resumeId],
  );

  const contentRef = useRef<HTMLTextAreaElement>(null);

  const loadPreview = useCallback(async (id: string) => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/application-materials/${id}/preview`, { cache: 'no-store' });
      if (!res.ok) throw new Error('preview failed');
      const json = await res.json();
      setPreviewLayout(json.layout ?? null);
    } catch {
      setPreviewLayout(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setJobsLoading(true);
      try {
        const data = await fetchJobs();
        setJobs(data);
      } finally {
        setJobsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    void fetchResumes()
      .then(setResumes)
      .catch(() => setResumeLoadError('Could not load your saved resumes. You can still generate without one.'))
      .finally(() => setResumesLoading(false));
  }, []);

  // A query id that does not name one of the user's own records must not linger
  // in the form: sending it would turn a typo into a 404 at generation time.
  useEffect(() => {
    if (mode !== 'create' || jobsLoading || !form.jobId) return;
    if (jobs.some((job) => job.id === form.jobId)) return;
    const stale = form.jobId;
    setForm((prev) => (prev.jobId === stale ? { ...prev, jobId: null } : prev));
  }, [mode, jobsLoading, jobs, form.jobId]);

  useEffect(() => {
    if (mode !== 'create' || resumesLoading || !form.resumeId) return;
    if (resumes.some((resume) => resume.id === form.resumeId)) return;
    const stale = form.resumeId;
    setForm((prev) => (prev.resumeId === stale ? { ...prev, resumeId: null } : prev));
  }, [mode, resumesLoading, resumes, form.resumeId]);

  // Keep tone and length valid when the type changes. A LinkedIn note has no
  // FORMAL tone or DETAILED length, and silently sending a value the server
  // will discard would leave no button looking selected.
  useEffect(() => {
    setForm((prev) => {
      const tone = resolveTone(prev.type, prev.tone);
      const length = resolveLength(prev.type, prev.length);
      return tone === prev.tone && length === prev.length ? prev : { ...prev, tone, length };
    });
  }, [form.type]);

  // When in edit mode, load the existing material.
  useEffect(() => {
    if (mode !== 'edit' || !materialIdFromUrl) return;
    let cancelled = false;
    void (async () => {
      setMaterialLoading(true);
      try {
        const res = await fetch(`/api/application-materials/${materialIdFromUrl}`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error?.message ?? 'Could not load this application material.');
        }
        if (cancelled) return;
        const stored = (json.data ?? {}) as StoredMaterialResult;
        const storedType = isMaterialType(json.type) ? json.type : DEFAULT_TYPE;
        setForm((prev) => ({
          ...prev,
          type: storedType,
          jobId: typeof json.jobId === 'string' ? json.jobId : null,
          resumeId: typeof json.resumeId === 'string' ? json.resumeId : null,
          tone: resolveTone(storedType, stored.meta?.tone),
          length: resolveLength(storedType, stored.meta?.length),
          instructions: '',
          recipientName: '',
          conversation: '',
        }));
        setResult({
          content: json.content ?? '',
          subject: json.subject,
          greeting: stored.greeting ?? '',
          senderName: stored.senderName ?? '',
          signOff: stored.signOff ?? '',
          warnings: stored.warnings ?? [],
          missingInformation: stored.missingInformation ?? [],
          unsupported: stored.unsupported ?? [],
          claims: stored.claims ?? [],
        });
        setMaterialId(json.id);
        setEditVersion(json.editVersion ?? 1);
        setSaved(json.status === 'READY');
        setContentDirty(false);
        void loadPreview(json.id);
      } catch {
        if (!cancelled) setError('Could not load this application material. Please try again.');
      } finally {
        if (!cancelled) setMaterialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, materialIdFromUrl, loadPreview]);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setResult(null);
    setSaved(false);
    setGenerating(true);

    try {
      const res = await fetch('/api/application-materials/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          type: form.type,
          jobId: form.jobId,
          resumeId: form.resumeId,
          tone: form.tone,
          length: form.length,
          instructions: form.instructions.trim() || undefined,
          conversation: form.conversation.trim() || undefined,
          recipientName: form.recipientName.trim() || undefined,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error?.code === 'PLAN_REQUIRED') {
          setError(
            `This AI feature is available with ${json.error.requiredPlan?.charAt(0) +
              json.error.requiredPlan?.slice(1).toLowerCase()}. ${
              json.error.message
            }`,
          );
        } else {
          setError(json.error?.message || 'Generation failed. Please try again.');
        }
        return;
      }

      const material = json.result;
      setResult({
        content: material.content,
        subject: material.subject,
        greeting: material.greeting,
        senderName: material.senderName,
        signOff: material.signOff,
        warnings: material.warnings,
        missingInformation: material.missingInformation,
        unsupported: material.unsupported,
        claims: material.claims,
      });
      setMaterialId(json.materialId);
      setSaved(false);
      setContentDirty(false);
      if (json.materialId) void loadPreview(json.materialId);
    } catch {
      setError('Generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [form, loadPreview]);

  const handleRevise = useCallback(async () => {
    if (!materialId) return;

    if (contentDirty) {
      setError('Save your edits first so the revision starts from the text you see.');
      return;
    }

    const instructions = form.instructions.trim();
    if (!instructions) {
      setError('Tell us what you would like to change before asking for a revision.');
      return;
    }

    setRevising(true);
    setError(null);
    try {
      const res = await fetch(`/api/application-materials/${materialId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          id: materialId,
          instructions,
          tone: form.tone,
          length: form.length,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error?.message ?? 'Could not create a revision. Please try again.');
        return;
      }

      const nextId = typeof json.materialId === 'string' ? json.materialId : null;
      if (!nextId) {
        setError('The revision was created but could not be opened. Check your application kit.');
        return;
      }

      setForm((prev) => ({ ...prev, instructions: '' }));
      router.push(`/application-materials/${nextId}?revised=1`);
    } catch {
      setError('Could not create a revision. Please try again.');
    } finally {
      setRevising(false);
    }
  }, [materialId, contentDirty, form.instructions, form.tone, form.length, router]);

  const handleSave = useCallback(async () => {
    if (!result || !materialId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/application-materials/${materialId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          id: materialId,
          content: result.content,
          subject: result.subject,
          expectedEditVersion: editVersion,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error?.message ?? 'Could not save this material. Please try again.');
        return;
      }
      setEditVersion(json.editVersion ?? editVersion + 1);
      setSaved(true);
      setContentDirty(false);
      if (materialId) void loadPreview(materialId);
    } catch {
      setError('Could not save this material.');
    } finally {
      setSaving(false);
    }
  }, [result, materialId, editVersion, loadPreview]);

  const handleDelete = useCallback(async () => {
    if (!materialId || !window.confirm('Permanently delete this material? This cannot be undone.')) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/application-materials/${materialId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error?.message ?? 'Could not delete this material.');
        return;
      }
      router.replace('/application-materials');
    } catch {
      setError('Could not delete this material.');
    } finally {
      setDeleting(false);
    }
  }, [materialId, router]);

  const handleCopy = async () => {
    if (!result) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(result.content);
    } catch {
      setError('Could not copy to clipboard.');
    } finally {
      setTimeout(() => setCopying(false), 1500);
    }
  };

  const handleDownload = async (format: 'txt' | 'pdf' | 'docx') => {
    if (!result || !materialId) return;
    // Exports are rendered from the stored row, not from this textarea. Saving
    // first keeps the file identical to the draft the user is looking at.
    if (contentDirty) {
      setError('Save your edits first so the download matches the text you see.');
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/application-materials/${materialId}/export.${format}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        setError('Could not download the document.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(result.subject || form.type.toLowerCase().replace(/_/g, '-')).replace(
        /[^\w\s.-]+/g,
        '',
      )}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download the document.');
    } finally {
      setDownloading(false);
    }
  };

  const typeItems = MATERIAL_TYPES.map((t) => {
    const m = MATERIAL_TYPE_META[t];
    return {
      value: t,
      label: m.label,
      description: m.description,
    };
  });

  const canRevise = Boolean(form.instructions.trim()) && !revising && !contentDirty;
  // Only link to a kit that still exists. In edit mode the stored job id may
  // point at a job that was since removed from the pipeline.
  const jobKitHref = selectedJob ? `/application-materials/jobs/${selectedJob.id}` : null;

  if (materialLoading) {
    return <div className="card-pad">Loading your application material…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === 'edit' ? 'Edit application material' : 'Create material'}
        subtitle={
          mode === 'edit'
            ? 'Review and save this draft, or ask for a revision written from it.'
            : 'Choose a material type, add context, and generate a draft.'
        }
        action={
          <div className="flex flex-wrap gap-2">
            {jobKitHref ? (
              <Link href={jobKitHref} className="btn-secondary text-xs">
                ← Job kit
              </Link>
            ) : null}
            <Link href="/application-materials" className="btn-secondary text-xs">
              Application library
            </Link>
            {mode === 'edit' && materialId ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="btn-secondary text-xs text-danger-text"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            ) : null}
          </div>
        }
      />

      {revisionCreated ? (
        <div
          role="status"
          className="rounded-xl border border-success/25 bg-success/[0.08] px-4 py-3 text-sm text-success-text"
        >
          Revision created. Your earlier draft is unchanged and still available in the job kit.
        </div>
      ) : null}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-warn/25 bg-warn/[0.07] px-4 py-3 text-sm text-warn-text"
        >
          {error}
        </div>
      )}

      {/* Material type selection (create) or read-only identity (edit). */}
      {mode === 'create' ? (
        <section className="card-pad">
          <div className="text-sm font-medium text-muted mb-3">
            What would you like to create?
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {typeItems.map((item) => {
              const active = form.type === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setForm((prev) => ({ ...prev, type: item.value as MaterialType }))
                  }
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    active
                      ? 'border-accent bg-accent/[0.06] text-ink'
                      : 'border-line hover:border-line-strong text-ink-2'
                  }`}
                >
                  <div className="font-medium text-sm">{item.label}</div>
                  <div className="text-xs text-muted mt-1">{item.description}</div>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="card-pad">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Material type
          </div>
          <p className="mt-1 text-sm font-medium text-ink">{meta.label}</p>
          <p className="muted mt-1 text-xs">{meta.description}</p>
        </section>
      )}

      {/* Configuration form. In edit mode this configures the revision. */}
      <section className="card-pad space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            {mode === 'edit' ? 'Ask for a revision' : 'Configure'}
          </h2>
          <p className="muted mt-1 text-xs">
            {mode === 'edit'
              ? 'A revision is written from this draft plus your guidance. It is saved as a new version, so this one is never overwritten.'
              : 'Everything below is context you control. Nothing is sent until you send it yourself.'}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="col-span-2 md:col-span-1">
            <span className="text-sm font-medium text-ink block mb-1">Tone</span>
            <div className="flex flex-wrap gap-1">
              {toneOptions.map((t) => {
                const active = form.tone === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setForm((prev) => ({ ...prev, tone: t }))}
                    className={`text-xs rounded-xl border px-3 py-1.5 transition-colors ${
                      active
                        ? 'border-accent bg-accent/[0.06] font-medium text-ink'
                        : 'border-line hover:border-line-strong text-ink-2'
                    }`}
                  >
                    {TONE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="col-span-2 md:col-span-1">
            <span className="text-sm font-medium text-ink block mb-1">Length</span>
            <div className="flex flex-wrap gap-1">
              {lengthOptions.map((l) => {
                const active = form.length === l;
                return (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setForm((prev) => ({ ...prev, length: l }))}
                    className={`text-xs rounded-xl border px-3 py-1.5 transition-colors ${
                      active
                        ? 'border-accent bg-accent/[0.06] font-medium text-ink'
                        : 'border-line hover:border-line-strong text-ink-2'
                    }`}
                  >
                    {LENGTH_LABELS[l]}
                  </button>
                );
              })}
            </div>
          </div>

          {supportsJob && (
            <div className="col-span-2">
              <label className="text-sm font-medium text-ink block mb-1" htmlFor="material-job">
                Target job
              </label>
              {mode === 'edit' ? (
                <>
                  <div className="rounded-xl border border-line bg-surface-sunken p-3 text-sm text-ink">
                    {jobsLoading
                      ? 'Loading job…'
                      : selectedJob
                        ? `${selectedJob.title} at ${selectedJob.company}`
                        : form.jobId
                          ? 'This job is no longer in your pipeline.'
                          : 'No target job'}
                  </div>
                  <p className="muted text-xs mt-1">
                    A revision keeps the same job and resume. Open the job kit to link another
                    resume or write a different material for this role.
                  </p>
                </>
              ) : jobsLoading ? (
                <div className="text-xs text-muted">Loading jobs…</div>
              ) : (
                <>
                  <select
                    id="material-job"
                    className="input"
                    value={form.jobId ?? ''}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, jobId: e.target.value || null }))
                    }
                  >
                    <option value="">None (general message)</option>
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title} at {job.company} ({job.status})
                      </option>
                    ))}
                  </select>
                  <p className="muted text-xs mt-1">
                    Linking a job grounds the draft in the real role details and your application
                    record. Every material for it is grouped in the job&apos;s application kit.
                  </p>
                </>
              )}
            </div>
          )}

          <div className="col-span-2">
            <label className="text-sm font-medium text-ink block mb-1" htmlFor="material-resume">
              Resume to use
            </label>
            {mode === 'edit' ? (
              <>
                <div className="rounded-xl border border-line bg-surface-sunken p-3 text-sm text-ink">
                  {resumesLoading
                    ? 'Loading resume…'
                    : selectedResume
                      ? selectedResume.name
                      : form.resumeId
                        ? 'This resume is no longer available.'
                        : 'Your confirmed career profile'}
                </div>
                <p className="muted text-xs mt-1">
                  A revision keeps the resume this draft was written with.
                </p>
              </>
            ) : resumesLoading ? (
              <div className="text-xs text-muted">Loading resumes…</div>
            ) : (
              <select
                id="material-resume"
                className="input"
                value={form.resumeId ?? ''}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, resumeId: event.target.value || null }))
                }
              >
                <option value="">Use my confirmed career profile</option>
                {resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.name}
                  </option>
                ))}
              </select>
            )}
            {mode === 'create' && resumeLoadError ? (
              <p className="mt-1 text-xs text-danger-text">{resumeLoadError}</p>
            ) : mode === 'create' && resumes.length === 0 && !resumesLoading ? (
              <p className="muted mt-1 text-xs">
                Build a resume from your confirmed career profile to use its exact wording here.{' '}
                <Link href="/resumes" className="underline underline-offset-2">
                  Open resumes
                </Link>
              </p>
            ) : mode === 'create' ? (
              <p className="muted mt-1 text-xs">
                When selected, this resume is included as additional evidence for the draft.
              </p>
            ) : null}
          </div>

          <div className="col-span-2">
            <label
              className="text-sm font-medium text-ink block mb-1"
              htmlFor="material-instructions"
            >
              {mode === 'edit' ? 'What should change?' : 'Your instructions (optional)'}
            </label>
            <textarea
              id="material-instructions"
              className="input min-h-[100px] resize-y"
              value={form.instructions}
              maxLength={2000}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, instructions: e.target.value }))
              }
              placeholder={
                mode === 'edit'
                  ? 'e.g. Shorten the opening, emphasise the API work, and keep the closing warm.'
                  : 'e.g. Emphasise my API experience, keep the tone warm, or shorten the second paragraph.'
              }
            />
            <p className="muted text-xs mt-1">
              {mode === 'edit'
                ? 'Required for a revision. Guidance changes wording and emphasis; it can never add a fact to your record.'
                : 'These are treated as style guidance only — they can never add a fact that isn’t in your profile.'}
            </p>
          </div>
        </div>

        {mode === 'create' && showRecipient && (
          <div className="col-span-2">
            <label
              className="text-sm font-medium text-ink block mb-1"
              htmlFor="material-recipient"
            >
              Recipient name (optional)
            </label>
            <input
              id="material-recipient"
              className="input"
              value={form.recipientName}
              maxLength={120}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, recipientName: e.target.value }))
              }
              placeholder="e.g. Priya Patel"
            />
            <p className="muted text-xs mt-1">
              Only use a name you know from a saved contact or your own outreach.
            </p>
          </div>
        )}

        {mode === 'create' && showInterviewNotes && (
          <div className="col-span-2">
            <label className="text-sm font-medium text-ink block mb-1" htmlFor="material-notes">
              What did you actually discuss? (optional)
            </label>
            <textarea
              id="material-notes"
              className="input min-h-[90px] resize-y"
              value={form.conversation}
              maxLength={4000}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, conversation: e.target.value }))
              }
              placeholder="The interviewer, the topics, anything you want to refer to. Only what really happened."
            />
            <p className="muted text-xs mt-1">
              If no interview is recorded in your pipeline, your own notes are required before a
              thank-you can be written.
            </p>
          </div>
        )}

        {mode === 'create' && showSharedContext && (
          <div className="col-span-2">
            <label className="text-sm font-medium text-ink block mb-1" htmlFor="material-context">
              Shared context (optional)
            </label>
            <textarea
              id="material-context"
              className="input min-h-[80px] resize-y"
              value={form.conversation}
              maxLength={4000}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, conversation: e.target.value }))
              }
              placeholder="Any genuine context from a previous exchange."
            />
            <p className="muted text-xs mt-1">
              What actually happened, in your own words. Never invented.
            </p>
          </div>
        )}

        {mode === 'create' && isApplicationGrounded && form.jobId && (
          <p className="muted text-xs">
            This material describes a real application. It will only be generated when your
            pipeline supports that claim.
          </p>
        )}
      </section>

      {/* Primary action: generate a new draft, or revise this one. */}
      <div className="card-pad">
        {mode === 'edit' ? (
          <>
            <button
              type="button"
              disabled={!canRevise}
              onClick={() => void handleRevise()}
              className="btn-primary w-full md:w-auto disabled:opacity-50"
            >
              {revising ? 'Writing a revision…' : 'Create revision'}
            </button>
            <p className="muted text-xs mt-2">
              {revising
                ? 'This calls the AI provider once. Your current draft is untouched.'
                : contentDirty
                  ? 'Save your edits above first, so the revision starts from the text you see.'
                  : form.instructions.trim()
                    ? 'Uses one AI credit. The new version is saved separately so this draft stays intact.'
                    : 'Add what you would like to change above to enable a revision.'}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={generating}
              onClick={handleGenerate}
              className="btn-primary w-full md:w-auto disabled:opacity-50"
            >
              {generating ? 'Generating draft…' : 'Generate draft'}
            </button>
            {generating && (
              <p className="muted text-xs mt-2">
                This calls the AI provider once and is metered against your AI allowance.
              </p>
            )}
          </>
        )}
      </div>

      {/* Review and edit */}
      {result && (
        <section className="card-pad space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">Draft</h2>
              {contentDirty ? (
                <span className="badge bg-warn/15 text-warn-text">Unsaved edits</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleDownload('txt')}
                disabled={downloading}
                className="btn-secondary text-xs"
              >
                {downloading ? '…' : 'Download .txt'}
              </button>
              {supportsPdf && (
                <button
                  type="button"
                  onClick={() => handleDownload('pdf')}
                  disabled={downloading}
                  className="btn-secondary text-xs"
                >
                  {downloading ? '…' : 'Download PDF'}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDownload('docx')}
                disabled={downloading}
                className="btn-secondary text-xs"
              >
                {downloading ? '…' : 'Download DOCX'}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={copying}
                className="btn-secondary text-xs"
              >
                {copying ? 'Copied!' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setShowPreview((value) => !value)}
                className="btn-secondary text-xs"
              >
                {showPreview ? 'Hide preview' : 'Show preview'}
              </button>
              {materialId && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-secondary text-xs"
                >
                  {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
                </button>
              )}
              {mode === 'create' && materialId ? (
                <Link href={`/application-materials/${materialId}`} className="btn-primary text-xs">
                  Continue in editor
                </Link>
              ) : null}
            </div>
          </div>

          {result.subject && (
            <div>
              <div className="text-xs text-muted uppercase tracking-wide mb-1">
                Subject
              </div>
              <div className="rounded-xl border border-line bg-surface-sunken p-3 text-sm mb-4">
                {result.subject}
              </div>
            </div>
          )}
          <div className="rounded-xl border border-line bg-card p-4 text-sm leading-relaxed max-h-96 overflow-auto font-sans whitespace-pre-wrap">
            {result.greeting && <div className="font-medium mb-2">{result.greeting}</div>}
            <textarea
              ref={contentRef}
              className="w-full min-h-[300px] resize-y border-none bg-transparent p-0 focus:ring-0 text-sm leading-relaxed"
              value={result.content}
              onChange={(event) => {
                setResult((current) =>
                  current ? { ...current, content: event.target.value } : current,
                );
                setSaved(false);
                setContentDirty(true);
              }}
            />
            {result.signOff && <div className="mt-4">{result.signOff}</div>}
            {result.senderName && <div className="mt-1">{result.senderName}</div>}
          </div>

          {showPreview && contentDirty ? (
            <p className="muted text-xs">
              The preview and downloads use the saved version until you save these edits.
            </p>
          ) : null}

          {showPreview && (
            <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
              {previewLoading ? (
                <div className="py-8 text-center text-sm text-muted">Loading preview…</div>
              ) : previewLayout ? (
                <ResumeLayoutPreview layout={previewLayout} availableWidth={640} />
              ) : (
                <div className="py-8 text-center text-sm text-muted">
                  Preview unavailable. Save the draft first.
                </div>
              )}
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-line-strong bg-surface-sunken p-3">
              <div className="text-xs font-medium text-ink mb-1">Things to check before sending</div>
              <ul className="text-sm text-ink-2 list-disc list-inside space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {result.missingInformation.length > 0 && (
            <div className="rounded-xl border border-accent/25 bg-accent/[0.04] p-3">
              <div className="text-xs font-medium text-accent-text mb-1">
                Would make the next draft better
              </div>
              <ul className="text-sm text-ink-2 list-disc list-inside space-y-1">
                {result.missingInformation.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          {result.unsupported.length > 0 && (
            <div className="rounded-xl border border-warn/25 bg-warn/[0.06] p-3">
              <div className="text-xs font-medium text-warn-text mb-1">
                Not supported by your records — review before sending
              </div>
              <ul className="text-sm text-ink-2 list-disc list-inside space-y-1">
                {result.unsupported.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Application-grounded hint when no job is selected yet. */}
      {mode === 'create' && isApplicationGrounded && !form.jobId && (
        <div className="rounded-xl border border-warn/25 bg-warn/[0.06] p-3 text-sm">
          Select the job this describes. A follow-up, status check or thank-you cannot be written
          honestly without the application record it refers to.
        </div>
      )}
    </div>
  );
}
