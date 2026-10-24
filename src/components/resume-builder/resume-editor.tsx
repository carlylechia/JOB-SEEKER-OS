'use client';

/**
 * The resume editor.
 *
 * Changes are saved automatically after a short pause. Saves are serialised and
 * revision-checked, so an older response cannot replace newer typing and edits
 * from another tab are still surfaced as a conflict. The preview is updated
 * from the exact layout returned by the successful save, keeping it aligned
 * with the exported document.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  GripVertical,
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
import { OptimizationPanelBoundary } from './optimization-panel-boundary';
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
  sectionOrder: ResumeSectionKey[];
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

type ResumeDraft = Pick<
  SerialisedResume,
  | 'content'
  | 'name'
  | 'templateKey'
  | 'pageSize'
  | 'accentKey'
  | 'density'
  | 'hiddenSections'
  | 'sectionOrder'
  | 'targetJobId'
>;

const AUTO_SAVE_DELAY_MS = 1_200;

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
  const [sectionOrder, setSectionOrder] = useState<ResumeSectionKey[]>(resume.sectionOrder);
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
  const [previewError, setPreviewError] = useState('');
  const [draggingSection, setDraggingSection] = useState<ResumeSectionKey | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const revisionRef = useRef(resume.revision);
  const draftVersionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewGenerationRef = useRef(0);
  const retryCountRef = useRef(0);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const savedRef = useRef<ResumeDraft>({
    content: resume.content,
    name: resume.name.trim(),
    templateKey: resume.templateKey,
    pageSize: resume.pageSize,
    accentKey: resume.accentKey,
    density: resume.density,
    hiddenSections: resume.hiddenSections,
    sectionOrder: resume.sectionOrder,
    targetJobId: resume.targetJobId,
  });

  const draft = useMemo<ResumeDraft>(() => ({
    content,
    name: name.trim(),
    templateKey,
    pageSize,
    accentKey,
    density,
    hiddenSections,
    sectionOrder,
    targetJobId,
  }), [content, name, templateKey, pageSize, accentKey, density, hiddenSections, sectionOrder, targetJobId]);
  const latestDraftRef = useRef(draft);
  latestDraftRef.current = draft;

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedRef.current);

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

  const markDraftChanged = useCallback(() => {
    draftVersionRef.current += 1;
    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setValidationErrors([]);
    setSaveState((current) => current === 'saving' || current === 'conflict' ? current : 'idle');
  }, []);

  const setSection = useCallback(
    (next: Partial<ResumeContent>) => {
      setContent((current) => ({ ...current, ...next }));
      markDraftChanged();
    },
    [markDraftChanged],
  );

  const scheduleSaveRetry = useCallback(() => {
    if (retryCountRef.current >= 2 || retryTimerRef.current) return;
    const delay = 1_500 * (2 ** retryCountRef.current);
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void saveRef.current();
    }, delay);
  }, []);

  const save = useCallback(async () => {
    if (saveInFlightRef.current) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const snapshot = latestDraftRef.current;
    if (JSON.stringify(snapshot) === JSON.stringify(savedRef.current)) {
      setSaveState('saved');
      setMessage('All changes saved.');
      return;
    }

    setSaveState('saving');
    setMessage('');
    setValidationErrors([]);

    // Validate locally first so the user gets every problem at once rather than
    // one per round trip.
    const parsed = resumeContentSchema.safeParse(snapshot.content);
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

    saveInFlightRef.current = true;
    const sentVersion = draftVersionRef.current;
    try {
      const response = await fetch(`/api/resumes/${resume.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          expectedRevision: revisionRef.current,
          name: snapshot.name,
          content: parsed.data,
          templateKey: snapshot.templateKey,
          pageSize: snapshot.pageSize,
          accentKey: snapshot.accentKey,
          density: snapshot.density,
          hiddenSections: snapshot.hiddenSections,
          sectionOrder: snapshot.sectionOrder,
          targetJobId: snapshot.targetJobId,
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
        if (response.status === 429 || response.status >= 500) scheduleSaveRetry();
        return;
      }

      const returnedContent = resumeContentSchema.safeParse(payload?.resume?.content);
      if (!payload?.resume || !payload?.layout) {
        setSaveState('error');
        setMessage('The server saved your changes but returned an incomplete response. Your edits are still here; retry to sync the editor.');
        return;
      }

      const persistedDraft: ResumeDraft = {
        // Keep the sent, validated content as a safe fallback if an older or
        // misconfigured API deployment omits it from the save response.
        content: returnedContent.success ? returnedContent.data : parsed.data,
        name: payload.resume.name as string,
        templateKey: payload.resume.templateKey as string,
        pageSize: payload.resume.pageSize as PageSizeKey,
        accentKey: payload.resume.accentKey as string,
        density: payload.resume.density as number,
        hiddenSections: payload.resume.hiddenSections as string[],
        sectionOrder: payload.resume.sectionOrder as ResumeSectionKey[],
        targetJobId: payload.resume.targetJobId as string | null,
      };
      savedRef.current = persistedDraft;
      revisionRef.current = payload.resume.revision as number;
      setRevision(revisionRef.current);
      if (draftVersionRef.current === sentVersion) {
        previewGenerationRef.current += 1;
        setLayout(payload.layout);
        setPreviewError('');
        setContent(persistedDraft.content);
        setName(persistedDraft.name);
        setTemplateKey(persistedDraft.templateKey);
        setPageSize(persistedDraft.pageSize);
        setAccentKey(persistedDraft.accentKey);
        setDensity(persistedDraft.density);
        setHiddenSections(persistedDraft.hiddenSections);
        setSectionOrder(persistedDraft.sectionOrder);
        setTargetJobId(persistedDraft.targetJobId);
        setSaveState('saved');
        setMessage('All changes saved.');
        retryCountRef.current = 0;
      } else {
        setSaveState('dirty');
        setMessage('Saving your latest changes…');
      }
    } catch {
      setSaveState('error');
      setMessage('We could not reach the server. Your edits are still here; we will retry automatically.');
      scheduleSaveRetry();
    } finally {
      saveInFlightRef.current = false;
    }
  }, [resume.id, scheduleSaveRetry]);

  saveRef.current = save;

  useEffect(() => {
    if (!dirty || saveState === 'saving' || saveState === 'error' || saveState === 'conflict') return;
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void saveRef.current();
    }, AUTO_SAVE_DELAY_MS);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [dirty, saveState, draft]);

  useEffect(() => {
    if (!dirty) {
      setPreviewError('');
      return;
    }

    const generation = ++previewGenerationRef.current;
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      void (async () => {
        try {
          const response = await fetch(`/api/resumes/${resume.id}/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              content: draft.content,
              templateKey: draft.templateKey,
              pageSize: draft.pageSize,
              accentKey: draft.accentKey,
              density: draft.density,
              hiddenSections: draft.hiddenSections,
              sectionOrder: draft.sectionOrder,
            }),
          });
          const payload = await response.json().catch(() => null);
          if (generation !== previewGenerationRef.current) return;
          if (!response.ok || !payload?.layout) {
            setPreviewError(
              (payload?.error?.message as string | undefined) ??
                'The preview could not be updated. Your edits are still here.',
            );
            return;
          }
          setLayout(payload.layout as LayoutDocument);
          setPreviewError('');
        } catch {
          if (generation === previewGenerationRef.current) {
            setPreviewError('The preview could not be updated. Your edits are still here.');
          }
        }
      })();
    }, 350);

    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      if (previewGenerationRef.current === generation) previewGenerationRef.current += 1;
    };
  }, [dirty, draft, resume.id]);

  useEffect(() => () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty]);

  const reloadLatest = useCallback(async () => {
    if (saveInFlightRef.current) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const startingVersion = draftVersionRef.current;
    setSaveState('saving');
    setMessage('Loading the latest saved version…');
    try {
      const response = await fetch(`/api/resumes/${resume.id}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.resume || !payload?.layout) {
        throw new Error('Could not load the latest saved resume.');
      }
      if (draftVersionRef.current !== startingVersion) {
        setSaveState('conflict');
        setMessage('This resume changed while reloading. Try again to load the latest version.');
        return;
      }

      const latest: ResumeDraft = {
        content: payload.resume.content as ResumeContent,
        name: payload.resume.name as string,
        templateKey: payload.resume.templateKey as string,
        pageSize: payload.resume.pageSize as PageSizeKey,
        accentKey: payload.resume.accentKey as string,
        density: payload.resume.density as number,
        hiddenSections: payload.resume.hiddenSections as string[],
        sectionOrder: payload.resume.sectionOrder as ResumeSectionKey[],
        targetJobId: payload.resume.targetJobId as string | null,
      };
      savedRef.current = latest;
      latestDraftRef.current = latest;
      revisionRef.current = payload.resume.revision as number;
      setContent(latest.content);
      setName(latest.name);
      setTemplateKey(latest.templateKey);
      setPageSize(latest.pageSize);
      setAccentKey(latest.accentKey);
      setDensity(latest.density);
      setHiddenSections(latest.hiddenSections);
      setSectionOrder(latest.sectionOrder);
      setTargetJobId(latest.targetJobId);
      setRevision(revisionRef.current);
      setLayout(payload.layout as LayoutDocument);
      setSaveState('saved');
      setMessage('Latest saved version loaded.');
    } catch {
      setSaveState('conflict');
      setMessage('We could not reload the latest version. Please try again.');
    }
  }, [resume.id]);

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

  const reorderSection = useCallback((section: ResumeSectionKey, deltaOrTarget: number | ResumeSectionKey) => {
    const from = sectionOrder.indexOf(section);
    const to = typeof deltaOrTarget === 'number'
      ? from + deltaOrTarget
      : sectionOrder.indexOf(deltaOrTarget);
    if (from < 0 || to < 0) return;
    const boundedTarget = Math.max(0, Math.min(sectionOrder.length - 1, to));
    if (from === boundedTarget) return;
    const next = [...sectionOrder];
    next.splice(from, 1);
    next.splice(boundedTarget, 0, section);
    setSectionOrder(next);
    markDraftChanged();
  }, [sectionOrder, markDraftChanged]);

  const handleSectionDrop = useCallback((target: ResumeSectionKey, event: ReactDragEvent<HTMLLIElement>) => {
    event.preventDefault();
    const source = event.dataTransfer.getData('text/plain') as ResumeSectionKey;
    if ((RESUME_SECTION_KEYS as readonly string[]).includes(source)) reorderSection(source, target);
    setDraggingSection(null);
  }, [reorderSection]);

  const toggleSectionVisibility = useCallback((section: ResumeSectionKey) => {
    setHiddenSections((current) =>
      current.includes(section)
        ? current.filter((hidden) => hidden !== section)
        : [...current, section],
    );
    markDraftChanged();
  }, [markDraftChanged]);

  return (
    <div className="space-y-6">
      {/* Title, target job and the actions that affect the whole document. */}
      <section aria-labelledby="resume-heading" className="card-pad space-y-4">
        <div className="min-w-0 space-y-4">
          <div className="min-w-0 space-y-3">
            <h1 id="resume-heading" className="title">
              {name || 'Untitled resume'}
            </h1>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <TextField label="Resume name" value={name} maxLength={120} onChange={(value) => { setName(value); markDraftChanged(); }} />
              </div>
              <SelectField
                label="Target job"
                value={targetJobId ?? ''}
                onChange={(value) => {
                  setTargetJobId(value || null);
                  markDraftChanged();
                }}
                options={[
                  { value: '', label: 'No specific job' },
                  ...targetableJobs.map((job) => ({
                    value: job.id,
                    label: `${job.title} · ${job.company}`,
                  })),
                ]}
              />
            </div>
            <p className="min-w-0 text-xs leading-relaxed text-muted">
              {selectedJob
                ? selectedJob.hasDescription
                  ? 'Optimisation will use this job’s full description.'
                  : 'This job has no description saved yet. Add it in the job workspace for specific suggestions.'
                : 'Pick a job to unlock optimisation. The rest of the builder works without one.'}
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-line pt-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowOnePage((value) => !value)}
              aria-expanded={showOnePage}
              disabled={dirty || saveState === 'saving'}
              title={dirty ? 'Your edits will save automatically before you create a one-page version.' : undefined}
            >
              <Scissors className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {showOnePage ? 'Close one-page' : 'Create a one-page version'}
            </button>
            <a
              className={`btn-secondary ${dirty || saveState === 'saving' ? 'pointer-events-none opacity-50' : ''}`}
              href={`/api/resumes/${resume.id}/export.pdf`}
              aria-disabled={dirty || saveState === 'saving'}
              title={dirty ? 'Your resume will be ready to download after autosave.' : undefined}
              // A plain link so the browser handles the download natively; the
              // route still requires the session and enforces ownership.
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Download PDF
            </a>
            <a
              className={`btn-secondary ${dirty || saveState === 'saving' ? 'pointer-events-none opacity-50' : ''}`}
              href={`/api/resumes/${resume.id}/export.docx`}
              aria-disabled={dirty || saveState === 'saving'}
              title={dirty ? 'Your resume will be ready to download after autosave.' : undefined}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Download DOCX
            </a>
            <button type="button" className="btn-secondary" onClick={() => void duplicate()} disabled={busy || dirty || saveState === 'saving'}>
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
            <button
              type="button"
              className="btn-primary"
              onClick={() => void save()}
              disabled={!dirty || saveState === 'saving' || saveState === 'conflict'}
            >
              {saveState === 'saving' ? (
                <Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : saveState === 'saved' && !dirty ? (
                <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
              ) : null}
              {dirty ? 'Save now' : 'Saved'}
            </button>
          </div>
        </div>

        <SaveStatus
          state={saveState}
          message={message}
          errors={validationErrors}
          dirty={dirty}
          onReload={() => { void reloadLatest(); }}
        />

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
                markDraftChanged();
              }}
              onAccentChange={(key) => {
                setAccentKey(key);
                markDraftChanged();
              }}
              onDensityChange={(value) => {
                setDensity(value);
                markDraftChanged();
              }}
              onPageSizeChange={(value) => {
                setPageSize(value);
                markDraftChanged();
              }}
              onHiddenSectionsChange={(sections) => {
                setHiddenSections(sections);
                markDraftChanged();
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
            <p className="sr-only">Drag sections to change their order, or use the include checkbox to add or remove a whole section from the resume.</p>
            <ul className="flex flex-wrap gap-2">
              {sectionOrder.map((section, index) => {
                const active = activeSection === section;
                const count = sectionCounts[section];
                return (
                  <li
                    key={section}
                    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
                    onDrop={(event) => handleSectionDrop(section, event)}
                    className={`flex min-w-0 items-center overflow-hidden rounded-xl border transition-colors ${
                      active ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:bg-surface-hover'
                    } ${draggingSection === section ? 'opacity-50' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveSection(section)}
                      aria-current={active ? 'true' : undefined}
                      className={`min-w-0 truncate px-3 py-1.5 text-sm ${active ? 'font-medium text-ink' : 'text-ink-2'}`}
                    >
                      <span className={hiddenSections.includes(section) ? 'line-through text-muted' : undefined}>
                        {SECTION_LABELS[section]}
                      </span>
                      {count > 0 ? <span className="ml-1.5 text-xs text-muted">{count}</span> : null}
                    </button>
                    <label className="flex h-8 shrink-0 items-center border-l border-line/70 px-2">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-[#D4AF37]"
                        checked={!hiddenSections.includes(section)}
                        aria-label={`Include ${SECTION_LABELS[section]} in resume`}
                        onChange={() => toggleSectionVisibility(section)}
                      />
                    </label>
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', section);
                        setDraggingSection(section);
                      }}
                      onDragEnd={() => setDraggingSection(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp' && index > 0) {
                          event.preventDefault();
                          reorderSection(section, -1);
                        } else if (event.key === 'ArrowDown' && index < sectionOrder.length - 1) {
                          event.preventDefault();
                          reorderSection(section, 1);
                        }
                      }}
                      className="flex h-8 w-8 shrink-0 cursor-grab touch-none items-center justify-center border-l border-line/70 text-muted hover:text-ink active:cursor-grabbing"
                      aria-label={`Reorder ${SECTION_LABELS[section]}. Use the up and down arrow keys to move.`}
                      title="Drag to reorder, or focus and use the up/down arrow keys"
                    >
                      <GripVertical className="h-4 w-4" aria-hidden="true" />
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

          <OptimizationPanelBoundary>
            <ResumeOptimizationPanel
              resumeId={resume.id}
              revision={revision}
              targetJobId={targetJobId}
              canOptimize={access.canOptimize}
              hasUnsavedChanges={dirty}
              onApplied={({ revision: nextRevision, content: nextContent, layout: nextLayout }) => {
                revisionRef.current = nextRevision;
                setRevision(nextRevision);
                setContent(nextContent as ResumeContent);
                setLayout(nextLayout as LayoutDocument);
                savedRef.current = { ...savedRef.current, content: nextContent as ResumeContent };
                latestDraftRef.current = { ...latestDraftRef.current, content: nextContent as ResumeContent };
                setSaveState('idle');
                setMessage('Saved.');
              }}
            />
          </OptimizationPanelBoundary>

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
                    disabled={busy || dirty || saveState === 'saving'}
                  >
                    Delete permanently
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-secondary mt-3"
                onClick={() => setConfirmDelete(true)}
                disabled={busy || dirty || saveState === 'saving'}
              >
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
                  Preview updates as you edit. Downloads use the latest saved version.
                </p>
              ) : null}
              {previewError ? (
                <p className="mb-3 rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger-text" role="alert">
                  {previewError}
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
      ? 'Saving your changes…'
      : state === 'saved'
        ? 'All changes saved.'
        : state === 'conflict'
          ? message
          : state === 'error'
            ? message
            : dirty
              ? state === 'dirty'
                ? 'Saving your latest changes…'
                : 'Changes save automatically after a short pause.'
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
