'use client';

/**
 * Material editor.
 *
 * Handles creating a new draft, revising an existing one, and editing a saved
 * draft. Generation is an explicit user action; nothing is sent externally.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import {
  MATERIAL_TYPES,
  type MaterialType,
  type MaterialLength,
  type Tone,
  MATERIAL_TYPE_META,
  tonesFor,
  lengthsFor,
  resolveTone,
  resolveLength,
  TONES,
  LENGTHS,
  TONE_LABELS,
  LENGTH_LABELS,
} from '@/lib/application-materials/materials';
import { downloadHeaders } from '@/lib/application-materials/download';

type JobOption = { id: string; title: string; company: string; status: string };
type ResumeOption = { id: string; name: string };

type EditorMode = 'create' | 'edit';

type FormValues = {
  type: MaterialType;
  jobId: string | null;
  resumeId: string | null;
  tone: Tone;
  length: MaterialLength;
  instructions: string;
  recipientName: string;
  conversation: string;
  sourceDraft: string;
};

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
  const [mode, setMode] = useState<EditorMode>(materialIdFromUrl ? 'edit' : 'create');

  useEffect(() => {
    if (materialIdFromUrl) setMode('edit');
  }, [materialIdFromUrl]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [resumesLoading, setResumesLoading] = useState(true);
  const [resumeLoadError, setResumeLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormValues>({
    type: 'COVER_LETTER',
    jobId: searchParams.get('job') || null,
    resumeId: null,
    tone: 'PROFESSIONAL',
    length: 'STANDARD',
    instructions: '',
    recipientName: '',
    conversation: '',
    sourceDraft: '',
  });

  const [generating, setGenerating] = useState(false);
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
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState(1);

  const toneOptions = useMemo(() => tonesFor(form.type), [form.type]);
  const lengthOptions = useMemo(() => lengthsFor(form.type), [form.type]);
  const meta = MATERIAL_TYPE_META[form.type];
  const isApplicationGrounded =
    form.type === 'APPLICATION_FOLLOW_UP' ||
    form.type === 'APPLICATION_STATUS_CHECK' ||
    form.type === 'INTERVIEW_THANK_YOU';
  const supportsJob = Boolean(meta?.requiresJob);
  const supportsPdf = Boolean(meta?.supportsPdf);
  const supportsSubject = Boolean(meta?.supportsSubject);

  const contentRef = useRef<HTMLTextAreaElement>(null);

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

  // When the type changes, reset the job if the new type doesn't need one.
  useEffect(() => {
    if (!supportsJob) setForm((prev) => ({ ...prev, jobId: null }));
  }, [form.type, supportsJob]);

  // When in edit mode, load the existing material.
  useEffect(() => {
    if (mode !== 'edit' || !materialIdFromUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/application-materials/${materialIdFromUrl}`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          if (cancelled) return;
          setForm((prev) => ({
            ...prev,
            type: json.type as MaterialType,
            jobId: json.jobId ?? null,
            resumeId: json.resumeId ?? null,
          }));
          setResult({
            content: json.content,
            subject: json.subject,
            greeting: '',
            senderName: '',
            signOff: '',
            warnings: [],
            missingInformation: [],
            unsupported: [],
            claims: [],
          });
          setMaterialId(json.id);
          setEditVersion(json.editVersion ?? 1);
          setSaved(true);
        }
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, materialIdFromUrl]);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setResult(null);
    setSaved(false);
    setGenerating(true);

    try {
      const res = await fetch('/api/application-materials/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          jobId: form.jobId,
          resumeId: form.resumeId,
          tone: form.tone,
          length: form.length,
          instructions: form.instructions || undefined,
          conversation: form.conversation || undefined,
          recipientName: form.recipientName || undefined,
          sourceDraft: form.sourceDraft || undefined,
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
    } catch {
      setError('Generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [form]);

  const handleSave = useCallback(async () => {
    if (!result || !materialId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/application-materials/${materialId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: materialId,
          title: form.type === 'COVER_LETTER' ? 'Cover letter' : form.type.replace(/_/g, ' '),
          content: result.content,
          subject: result.subject,
          expectedEditVersion: editVersion,
        }),
      });
      if (!res.ok) {
        setError('The draft changed elsewhere. Reopen it and apply your edit again.');
        return;
      }
      const json = await res.json();
      setEditVersion(json.editVersion ?? editVersion + 1);
      setSaved(true);
    } catch {
      setError('Could not save the draft.');
    } finally {
      setSaving(false);
    }
  }, [result, materialId, editVersion, form.type]);

  const handleDelete = useCallback(async () => {
    if (!materialId || !window.confirm('Permanently delete this material? This cannot be undone.')) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/application-materials/${materialId}`, {
        method: 'DELETE',
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
      setSaved(true);
    } catch {
      setError('Could not copy to clipboard.');
    } finally {
      setTimeout(() => setCopying(false), 1500);
    }
  };

  const handleDownload = async (format: 'txt' | 'pdf' | 'docx') => {
    if (!result || !materialId) return;
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

  const handleRevise = () => {
    if (!result) return;
    setForm((prev) => ({
      ...prev,
      sourceDraft: result.content,
    }));
    setMode('create');
    setError(null);
    setResult(null);
  };

  const typeItems = MATERIAL_TYPES.map((t) => {
    const m = MATERIAL_TYPE_META[t];
    return {
      value: t,
      label: m.label,
      description: m.description,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === 'edit' ? 'Edit draft' : 'Create material'}
        subtitle={
          mode === 'edit'
            ? 'Review, revise, and save your application material.'
            : 'Choose a material type, add context, and generate a draft.'
        }
        action={
          mode === 'edit' && materialId ? (
            <div className="flex gap-2">
              <Link href="/application-materials" className="btn-secondary text-xs">
                ← Back to library
              </Link>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="btn-secondary text-xs text-danger-text"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          ) : null
        }
      />

      {error && (
        <div className="rounded-xl border border-warn/25 bg-warn/[0.07] px-4 py-3 text-sm text-warn-text">
          {error}
        </div>
      )}

      {/* Material type selection */}
      <section className="card-pad">
        <div className="text-sm font-medium text-muted mb-3">What would you like to create?</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {typeItems.map((item) => {
            const active = form.type === item.value;
            return (
              <button
                key={item.value}
                type="button"
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

      {/* Configuration form */}
      <section className="card-pad space-y-5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-ink">Configure</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="col-span-2 md:col-span-1">
            <label className="text-sm font-medium text-ink block mb-1">Tone</label>
            <div className="flex gap-1">
              {toneOptions.map((t) => {
                const active = form.tone === t;
                return (
                  <button
                    key={t}
                    type="button"
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
            <label className="text-sm font-medium text-ink block mb-1">Length</label>
            <div className="flex gap-1">
              {lengthOptions.map((l) => {
                const active = form.length === l;
                return (
                  <button
                    key={l}
                    type="button"
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
              <label className="text-sm font-medium text-ink block mb-1">
                Target job
              </label>
              {jobsLoading ? (
                <div className="text-xs text-muted">Loading jobs…</div>
              ) : (
                <select
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
              )}
              <p className="muted text-xs mt-1">
                Linking a job grounds the draft in the real role details and your
                application record.
              </p>
            </div>
          )}

          <div className="col-span-2">
            <label className="text-sm font-medium text-ink block mb-1" htmlFor="material-resume">
              Resume to use (optional)
            </label>
            {resumesLoading ? (
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
            {resumeLoadError ? (
              <p className="mt-1 text-xs text-danger-text">{resumeLoadError}</p>
            ) : resumes.length === 0 && !resumesLoading ? (
              <p className="muted mt-1 text-xs">
                Build a resume from your confirmed career profile to use its exact wording here.{' '}
                <Link href="/resumes" className="underline underline-offset-2">
                  Open resumes
                </Link>
              </p>
            ) : (
              <p className="muted mt-1 text-xs">
                When selected, this resume is included as additional evidence for the draft.
              </p>
            )}
          </div>

          <div className="col-span-2">
            <label className="text-sm font-medium text-ink block mb-1">
              Your instructions (optional)
            </label>
            <textarea
              className="input min-h-[100px] resize-y"
              value={form.instructions}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, instructions: e.target.value }))
              }
              placeholder="e.g. Emphasise my API experience, keep the tone warm, or shorten the second paragraph."
            />
            <p className="muted text-xs mt-1">
              These are treated as style guidance only — they can never add a fact
              that isn&apos;t in your profile.
            </p>
          </div>
        </div>

        {(meta.fields.includes('RECIPIENT_NAME') || meta.fields.includes('CONTACT')) && (
          <div className="col-span-2">
            <label className="text-sm font-medium text-ink block mb-1">
              Recipient name (optional)
            </label>
            <input
              className="input"
              value={form.recipientName}
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

        {(meta.fields.includes('CONVERSATION') || meta.fields.includes('SHARED_CONTEXT')) && (
          <div className="col-span-2">
            <label className="text-sm font-medium text-ink block mb-1">
              Shared context (optional)
            </label>
            <textarea
              className="input min-h-[80px] resize-y"
              value={form.conversation}
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

        {isApplicationGrounded && form.jobId && (
          <div className="col-span-2">
            <p className="muted text-xs mt-1">
              This material describes a real application. It will only be
              generated when your pipeline supports that claim.
            </p>
          </div>
        )}
      </section>

      {/* Generate action */}
      <div className="card-pad">
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
            This calls the AI provider once and is metered against your AI
            allowance.
          </p>
        )}
      </div>

      {/* Review and edit */}
      {result && (
        <section className="card-pad space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Draft</h2>
            <div className="flex gap-2">
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
              <button
                type="button"
                onClick={handleRevise}
                className="btn-secondary text-xs"
              >
                New revision
              </button>
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
              defaultValue={result.content}
              readOnly
            />
            {result.signOff && <div className="mt-4">{result.signOff}</div>}
            {result.senderName && <div className="mt-1">{result.senderName}</div>}
          </div>

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

      {/* Apply-date gate hint for grounded types */}
      {isApplicationGrounded && form.jobId && !jobs.find((j) => j.id === form.jobId) && (
        <div className="rounded-xl border border-warn/25 bg-warn/[0.06] p-3 text-sm">
          Select a job to see whether your pipeline supports a follow-up or
          thank-you message for this role.
        </div>
      )}
    </div>
  );
}
