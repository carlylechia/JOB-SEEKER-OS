'use client';

/**
 * The resume editor.
 *
 * The whole interface is organised around one decision: an EXPLICIT SAVE, not
 * autosave.
 *
 * Autosave is genuinely nice until it is not. Two tabs, a flaky connection or a
 * save that lands out of order all turn it into silent data loss, and the only
 * way to make it safe is a revision counter, a debounce, a visible status and a
 * conflict dialog — at which point an explicit button with a status line is
 * simpler to reason about and easier to trust. So: changes are held locally,
 * the Save button says whether there is anything to save, the status line only
 * claims success once the server has confirmed the mutation, and a 409 from a
 * concurrent edit is surfaced as a conflict the user resolves deliberately
 * rather than papered over.
 *
 * The preview is not re-rendered from local state. It is the server's layout for
 * the SAVED document, and it says so when there are unsaved changes — because a
 * preview that quietly disagreed with the export would be worse than one that
 * admits what it is showing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  Loader,
  Settings2,
  Scissors,
  Trash2,
} from 'lucide-react';

import type { LayoutDocument } from '@/lib/resume-builder/layout';
import {
  RESUME_SECTION_KEYS,
  SECTION_LABELS,
  resumeContentSchema,
  type ResumeContent,
  type ResumeSectionKey,
} from '@/lib/resume-builder/schema';
import { ResumeLayoutPreview } from './resume-layout-preview';
import {
  BasicsEditor,
  CredentialsEditor,
  EducationEditor,
  ExperienceEditor,
  ProjectsEditor,
  SkillsEditor,
  SummaryEditor,
} from './section-editors';
import { TemplatePicker, type AccentOption, type TemplateOption } from './template-picker';
import { ResumeOptimizationPanel } from './optimization-panel';
import { OnePageReviewPanel } from './one-page-review-panel';
import { SelectField, TextField } from './fields';
import type { PageSizeKey } from '@/lib/resume-builder/templates';
import { checkResumeQuality } from '@/lib/resume-builder/quality';

type SerialisedResume = {
  id: string;
  name: string;
  origin: string;
  templateKey: string;
  pageSize: PageSizeKey;
  accentKey: string;
  density: number;
  hiddenSections: string[];
  revision: number;
  targetJobId: string | null;
  targetJob: { id: string; title: string; company: string } | null;
  content: ResumeContent;
};

type TargetableJob = {
  id: string;
  title: string;
  company: string;
  status: string;
  hasDescription: boolean;
};

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

type Props = {
  resume: SerialisedResume;
  layout: LayoutDocument;
  templates: TemplateOption[];
  accents: AccentOption[];
  densities: Record<string, string>;
  access: { canBuild: boolean; canOptimize: boolean; resumeLimit: number | null };
  targetableJobs: TargetableJob[];
};

export function ResumeEditor({
  resume,
  layout: initialLayout,
  templates,
  accents,
  densities,
  access,
  targetableJobs,
}: Props) {
  const router = useRouter();

  const [content, setContent] = useState<ResumeContent>(resume.content);
  const [name, setName] = useState(resume.name);
  const [templateKey, setTemplateKey] = useState(resume.templateKey);
  const [pageSize, setPageSize] = useState<PageSizeKey>(resume.pageSize);
  const [accentKey, setAccentKey] = useState(resume.accentKey);
  const [density, setDensity] = useState(resume.density);
  const [hiddenSections, setHiddenSections] = useState<string[]>(resume.hiddenSections);
  const [targetJobId, setTargetJobId] = useState<string | null>(resume.targetJobId);
  const [revision, setRevision] = useState(resume.revision);

  const [layout, setLayout] = useState<LayoutDocument>(initialLayout);
  const [activeSection, setActiveSection] = useState<ResumeSectionKey>('summary');
  const [showTemplate, setShowTemplate] = useState(false);
  const [showOnePage, setShowOnePage] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(640);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const dirty =
    saveState === 'dirty' ||
    JSON.stringify(content) !== JSON.stringify(resume.content) ||
    name !== resume.name ||
    templateKey !== resume.templateKey ||
    pageSize !== resume.pageSize ||
    accentKey !== resume.accentKey ||
    density !== resume.density ||
    JSON.stringify(hiddenSections) !== JSON.stringify(resume.hiddenSections) ||
    targetJobId !== resume.targetJobId;

  const qualityIssues = useMemo(
    () => checkResumeQuality(content, layout.pages.length),
    [content, layout.pages.length],
  );

  // The preview measures its own container so it can scale to whatever width the
  // viewport gives it — full width on mobile, a column on desktop.
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPreviewWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [showPreview]);

  const setSection = useCallback(
    (next: Partial<ResumeContent>) => {
      setContent((current) => ({ ...current, ...next }));
      setSaveState('dirty');
    },
    [],
  );

  /**
   * Re-render the preview for a presentation-only change.
   *
   * Hits the preview endpoint with the chosen settings, which lays out the
   * STORED document. Nothing is saved, nothing is billed, and the user's
   * unsaved edits are untouched.
   */
  const refreshPreview = useCallback(
    async (settings: { templateKey?: string; accentKey?: string; density?: number; hidden?: string[]; pageSize?: PageSizeKey }) => {
      const params = new URLSearchParams({
        template: settings.templateKey ?? templateKey,
        accent: settings.accentKey ?? accentKey,
        density: String(settings.density ?? density),
        hiddenSections: (settings.hidden ?? hiddenSections).join(','),
        pageSize: settings.pageSize ?? pageSize,
      });
      try {
        const response = await fetch(`/api/resumes/${resume.id}/preview?${params.toString()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { layout: LayoutDocument };
        setLayout(payload.layout);
      } catch {
        // A failed preview is cosmetic; the save is what matters. The old
        // layout stays on screen rather than blanking the panel.
      }
    },
    [resume.id, templateKey, accentKey, density, hiddenSections, pageSize],
  );

  const save = useCallback(async () => {
    if (saveState === 'saving') return;
    setSaveState('saving');
    setMessage('');
    setValidationErrors([]);

    // Validate locally first so the user gets every problem at once rather than
    // one per round trip.
    const parsed = resumeContentSchema.safeParse(content);
    if (!parsed.success) {
      setValidationErrors(
        parsed.error.issues.slice(0, 6).map((issue) =>
          issue.path.length > 0 ? `${issue.path.join(' → ')}: ${issue.message}` : issue.message,
        ),
      );
      setSaveState('error');
      setMessage('Some details need fixing before this can be saved.');
      return;
    }

    try {
      const response = await fetch(`/api/resumes/${resume.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          expectedRevision: revision,
          name: name.trim(),
          content: parsed.data,
          templateKey,
          pageSize,
          accentKey,
          density,
          hiddenSections,
          targetJobId,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (response.status === 409) {
        setSaveState('conflict');
        setMessage(
          (payload?.error?.message as string | undefined) ??
            'This resume changed somewhere else. Reload it before saving.',
        );
        return;
      }

      if (!response.ok) {
        const fields = (payload?.error?.meta?.fields as Array<{ path: string; message: string }>) ?? [];
        setValidationErrors(fields.map((field) => `${field.path}: ${field.message}`));
        setSaveState('error');
        setMessage((payload?.error?.message as string | undefined) ?? 'Those changes could not be saved.');
        return;
      }

      setContent(payload.resume.content);
      setRevision(payload.resume.revision);
      setLayout(payload.layout);
      setSaveState('saved');
      setMessage('Saved.');
      router.refresh();
    } catch {
      setSaveState('error');
      setMessage('We could not reach the server. Your edits are still here — try saving again.');
    }
  }, [saveState, content, name, revision, templateKey, pageSize, accentKey, density, hiddenSections, targetJobId, resume.id, router]);

  const duplicate = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/resumes/${resume.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${name} (copy)`, targetJobId }),
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage((payload?.error?.message as string | undefined) ?? 'Could not duplicate this resume.');
        return;
      }
      router.push(`/resumes/${payload.resume.id}`);
    } finally {
      setBusy(false);
    }
  }, [resume.id, name, targetJobId, router]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/resumes/${resume.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setMessage('Could not delete this resume. Please try again.');
        return;
      }
      router.push('/resumes');
      router.refresh();
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }, [resume.id, router]);

  const sectionCounts = useMemo(
    () => ({
      summary: content.summary ? 1 : 0,
      experience: content.experiences.length,
      education: content.education.length,
      skills: content.skills.length,
      projects: content.projects.length,
      credentials: content.credentials.length,
    }),
    [content],
  );

  const selectedJob = targetableJobs.find((job) => job.id === targetJobId) ?? null;

  return (
    <div className="space-y-6">
      {/* Title, target job and the actions that affect the whole document. */}
      <section aria-labelledby="resume-heading" className="card-pad space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0 space-y-3">
            <h1 id="resume-heading" className="title">
              {name || 'Untitled resume'}
            </h1>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Resume name" value={name} maxLength={120} onChange={(value) => { setName(value); setSaveState('dirty'); }} />
              <SelectField
                label="Target job"
                value={targetJobId ?? ''}
                onChange={(value) => {
                  setTargetJobId(value || null);
                  setSaveState('dirty');
                }}
                options={[
                  { value: '', label: 'No specific job' },
                  ...targetableJobs.map((job) => ({
                    value: job.id,
                    label: `${job.title} · ${job.company}${job.hasDescription ? '' : ' (no description)'}`,
                  })),
                ]}
              />
            </div>
            <p className="text-xs text-muted">
              {selectedJob
                ? selectedJob.hasDescription
                  ? 'Optimisation will use this job’s full description.'
                  : 'This job has no description saved yet. Add it in the job workspace for specific suggestions.'
                : 'Pick a job to unlock optimisation. The rest of the builder works without one.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowOnePage((value) => !value)}
              aria-expanded={showOnePage}
              disabled={dirty || saveState === 'saving'}
              title={dirty ? 'Save your current edits before creating a one-page version.' : undefined}
            >
              <Scissors className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {showOnePage ? 'Close one-page' : 'Create a one-page version'}
            </button>
            <a
              className="btn-secondary"
              href={`/api/resumes/${resume.id}/export.pdf`}
              // A plain link so the browser handles the download natively; the
              // route still requires the session and enforces ownership.
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Download PDF
            </a>
            <a className="btn-secondary" href={`/api/resumes/${resume.id}/export.docx`}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Download DOCX
            </a>
            <button type="button" className="btn-secondary" onClick={() => void duplicate()} disabled={busy}>
              {busy ? <Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Duplicate
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowPreview((value) => !value)}
              aria-pressed={showPreview}
            >
              <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {showPreview ? 'Hide preview' : 'Show preview'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowTemplate((value) => !value)}
              aria-expanded={showTemplate}
            >
              <Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Design
            </button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saveState === 'saving' || !dirty}>
              {saveState === 'saving' ? (
                <Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save
            </button>
          </div>
        </div>

        <SaveStatus state={saveState} message={message} errors={validationErrors} dirty={dirty} onReload={() => router.refresh()} />

        {showTemplate ? (
          <div className="rounded-xl border border-line bg-surface p-4">
            <TemplatePicker
              templates={templates}
              accents={accents}
              densities={densities}
              templateKey={templateKey}
              pageSize={pageSize}
              accentKey={accentKey}
              density={density}
              hiddenSections={hiddenSections}
              onTemplateChange={(key) => {
                setTemplateKey(key);
                setSaveState('dirty');
                void refreshPreview({ templateKey: key });
              }}
              onAccentChange={(key) => {
                setAccentKey(key);
                setSaveState('dirty');
                void refreshPreview({ accentKey: key });
              }}
              onDensityChange={(value) => {
                setDensity(value);
                setSaveState('dirty');
                void refreshPreview({ density: value });
              }}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setSaveState('dirty');
                void refreshPreview({ pageSize: value });
              }}
              onHiddenSectionsChange={(sections) => {
                setHiddenSections(sections);
                setSaveState('dirty');
                void refreshPreview({ hidden: sections });
              }}
            />
          </div>
        ) : null}
      </section>

      {showOnePage ? (
        <OnePageReviewPanel
          sourceId={resume.id}
          sourceName={resume.name}
          sourceRevision={revision}
          sourcePageSize={pageSize}
          sourceTargetJobId={targetJobId}
          targetableJobs={targetableJobs}
          canOptimize={access.canOptimize}
          onClose={() => setShowOnePage(false)}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="min-w-0 space-y-6">
          {/* Section navigation. A real nav with a current marker, so it works
              with a keyboard and is announced, rather than a row of buttons
              that only looks like tabs. */}
          <nav aria-label="Resume sections">
            <ul className="flex flex-wrap gap-2">
              {RESUME_SECTION_KEYS.map((section) => {
                const active = activeSection === section;
                const count = sectionCounts[section];
                return (
                  <li key={section}>
                    <button
                      type="button"
                      onClick={() => setActiveSection(section)}
                      aria-current={active ? 'true' : undefined}
                      className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? 'border-accent bg-accent/10 font-medium text-ink'
                          : 'border-line bg-surface text-ink-2 hover:bg-surface-hover'
                      }`}
                    >
                      {SECTION_LABELS[section]}
                      {count > 0 ? (
                        <span className="ml-1.5 text-xs text-muted">{count}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section aria-labelledby="section-heading" className="card-pad">
            <h2 id="section-heading" className="mb-4 text-base font-semibold text-ink">
              {SECTION_LABELS[activeSection]}
            </h2>

            {activeSection === 'summary' ? (
              <SummaryEditor summary={content.summary} onChange={(value) => setSection({ summary: value })} />
            ) : null}
            {activeSection === 'experience' ? (
              <ExperienceEditor entries={content.experiences} onChange={(entries) => setSection({ experiences: entries })} />
            ) : null}
            {activeSection === 'skills' ? (
              <SkillsEditor entries={content.skills} onChange={(entries) => setSection({ skills: entries })} />
            ) : null}
            {activeSection === 'education' ? (
              <EducationEditor entries={content.education} onChange={(entries) => setSection({ education: entries })} />
            ) : null}
            {activeSection === 'projects' ? (
              <ProjectsEditor entries={content.projects} onChange={(entries) => setSection({ projects: entries })} />
            ) : null}
            {activeSection === 'credentials' ? (
              <CredentialsEditor entries={content.credentials} onChange={(entries) => setSection({ credentials: entries })} />
            ) : null}

            {activeSection !== 'summary' ? (
              <details className="mt-6">
                <summary className="cursor-pointer text-xs text-muted">
                  {activeSection === 'credentials' ? 'Edit basic information instead' : 'Edit basic information'}
                </summary>
                <div className="mt-4">
                  <BasicsEditor basics={content.basics} onChange={(basics) => setSection({ basics })} />
                </div>
              </details>
            ) : null}
          </section>

          <ResumeOptimizationPanel
            resumeId={resume.id}
            revision={revision}
            targetJobId={targetJobId}
            canOptimize={access.canOptimize}
            onApplied={({ revision: nextRevision, content: nextContent, layout: nextLayout }) => {
              setRevision(nextRevision);
              setContent(nextContent as ResumeContent);
              setLayout(nextLayout as LayoutDocument);
              setSaveState('idle');
              setMessage('Saved.');
            }}
          />

          <section aria-labelledby="danger-heading" className="card-pad">
            <h2 id="danger-heading" className="text-base font-semibold text-ink">
              Delete this resume
            </h2>
            <p className="mt-1 text-sm text-muted">
              This removes this resume only. Your career profile, your uploaded files and any other
              version are untouched.
            </p>
            {confirmDelete ? (
              <div role="alertdialog" aria-label="Confirm deleting this resume" className="mt-3 rounded-xl border border-danger/40 bg-danger/5 p-3">
                <p className="text-sm text-ink">
                  Delete <strong>{name}</strong>? This cannot be undone.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ background: 'rgb(var(--danger))', color: '#fff' }}
                    onClick={() => void remove()}
                    disabled={busy}
                  >
                    Delete permanently
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-secondary mt-3" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Delete this resume
              </button>
            )}
          </section>
        </div>

        {showPreview ? (
          <div className="min-w-0">
            <div ref={previewRef} className="card-pad lg:sticky lg:top-24">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-ink">Preview</h2>
                <span className="text-xs text-muted">
                  {layout.pages.length} page{layout.pages.length === 1 ? '' : 's'}
                </span>
              </div>
              {dirty ? (
                <p className="mb-3 rounded-lg border border-warn/40 bg-warn/5 p-2 text-xs text-warn-text">
                  This is your last saved version. Save to see your changes here and in the PDF.
                </p>
              ) : null}
              <ResumeLayoutPreview layout={layout} availableWidth={previewWidth - 40} />
              {qualityIssues.length > 0 ? (
                <section className="mt-4 rounded-xl border border-warn/30 bg-warn/[0.05] p-3" aria-label="Resume review checks">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-warn-text">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Review before sending
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {qualityIssues.map((issue) => (
                      <li key={issue.code} className="text-xs text-warn-text">
                        <span className="font-medium">{issue.title}.</span> {issue.detail}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {resume.origin === 'ONE_PAGE' ? (
                <p className="mt-3 text-xs text-muted">
                  The PDF export is checked to stay on one page. Word-compatible apps may reflow the editable DOCX differently.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SaveStatus({
  state,
  message,
  errors,
  dirty,
  onReload,
}: {
  state: SaveState;
  message: string;
  errors: string[];
  dirty: boolean;
  onReload: () => void;
}) {
  const text =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
        ? 'Saved.'
        : state === 'conflict'
          ? message
          : state === 'error'
            ? message
            : dirty
              ? 'You have unsaved changes.'
              : 'Everything is saved.';

  const tone =
    state === 'conflict' || state === 'error'
      ? 'text-danger-text'
      : state === 'saved'
        ? 'text-success-text'
        : 'text-muted';

  return (
    <div>
      <p role="status" aria-live="polite" className={`flex items-center gap-1.5 text-sm ${tone}`}>
        {state === 'saving' ? (
          <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : state === 'saved' ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : state === 'conflict' || state === 'error' ? (
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        ) : null}
        {text}
      </p>
      {errors.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-6 text-xs text-danger-text">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      {state === 'conflict' ? (
        <button type="button" className="btn-secondary mt-2" onClick={onReload}>
          Reload this resume
        </button>
      ) : null}
    </div>
  );
}
