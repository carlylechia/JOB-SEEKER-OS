'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader, RefreshCw, Save, X } from 'lucide-react';
import { ResumeLayoutPreview } from './resume-layout-preview';
import { PAGE_SIZES, TEMPLATE_LIST, type PageSizeKey, type TemplateKey } from '@/lib/resume-builder/templates';
import type { ResumeContent } from '@/lib/resume-builder/schema';
import type { LayoutDocument } from '@/lib/resume-builder/layout';

type TargetJob = {
  id: string;
  title: string;
  company: string;
  hasDescription: boolean;
};

type Proposal = {
  content: ResumeContent;
  layout: LayoutDocument;
  pageCount: number;
  canSave: boolean;
  templateKey: TemplateKey;
  pageSize: PageSizeKey;
  includedKeys: string[];
  items: Array<{
    key: string;
    section: string;
    label: string;
    text: string;
    included: boolean;
    reason: string | null;
    editable: boolean;
  }>;
  rewrites: Array<{
    id: string;
    itemKey: string | null;
    section: string;
    originalText: string;
    proposedText: string;
    warnings: string[];
  }>;
  acceptedOperationIds: string[];
  warnings: string[];
  aiNotice: string | null;
};

type Props = {
  sourceId: string;
  sourceName: string;
  sourceRevision: number;
  sourcePageSize: PageSizeKey;
  sourceTargetJobId: string | null;
  targetableJobs: TargetJob[];
  canOptimize: boolean;
  onClose: () => void;
};

export function OnePageReviewPanel({
  sourceId,
  sourceName,
  sourceRevision,
  sourcePageSize,
  sourceTargetJobId,
  targetableJobs,
  canOptimize,
  onClose,
}: Props) {
  const router = useRouter();
  const [targetJobId, setTargetJobId] = useState(sourceTargetJobId ?? '');
  const [targetRole, setTargetRole] = useState('');
  const [objective, setObjective] = useState('');
  const [templateKey, setTemplateKey] = useState<TemplateKey>('classic-ats');
  const [pageSize, setPageSize] = useState<PageSizeKey>(sourcePageSize);
  const [useAi, setUseAi] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [includedKeys, setIncludedKeys] = useState<Set<string> | null>(null);
  const [acceptedOperationIds, setAcceptedOperationIds] = useState<Set<string>>(new Set());
  const [summaryDraft, setSummaryDraft] = useState('');
  const [summaryEdited, setSummaryEdited] = useState(false);
  const [editedItems, setEditedItems] = useState<Record<string, string>>({});
  const [resumeName, setResumeName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState('');
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState(600);

  const selectedJob = useMemo(
    () => targetableJobs.find((job) => job.id === targetJobId) ?? null,
    [targetableJobs, targetJobId],
  );

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPreviewWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [proposal]);

  const requestBody = useCallback((name?: string) => ({
    targetJobId: targetJobId || null,
    targetRole: targetJobId ? null : targetRole || null,
    objective: objective || null,
    templateKey,
    pageSize,
    useAi,
    ...(includedKeys ? { includedKeys: Array.from(includedKeys) } : {}),
    acceptedOperationIds: Array.from(acceptedOperationIds),
    ...(summaryEdited ? { summaryOverride: summaryDraft } : {}),
    ...(Object.keys(editedItems).length ? { editedItems } : {}),
    ...(name !== undefined ? { name, expectedRevision: sourceRevision } : {}),
  }), [targetJobId, targetRole, objective, templateKey, pageSize, useAi, includedKeys, acceptedOperationIds, summaryEdited, summaryDraft, editedItems, sourceRevision]);

  const generate = useCallback(async () => {
    const keepSummaryEdit = summaryEdited;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/resumes/${sourceId}/one-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(requestBody()),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error?.message ?? 'We could not prepare this one-page version.');
        return;
      }
      const nextProposal = payload.proposal as Proposal;
      setProposal(nextProposal);
      setIncludedKeys(new Set(nextProposal.includedKeys));
      setAcceptedOperationIds(new Set(nextProposal.acceptedOperationIds));
      setSummaryDraft(nextProposal.content.summary ?? '');
      setSummaryEdited(keepSummaryEdit);
      setTemplateKey(nextProposal.templateKey);
      setPageSize(nextProposal.pageSize);
      const job = payload.targetJob as { title: string } | null;
      setResumeName(`${job?.title ?? sourceName} — One-Page`.slice(0, 120));
      setStale(false);
    } catch {
      setMessage('We could not reach the server. Your source resume has not changed.');
    } finally {
      setBusy(false);
    }
  }, [requestBody, sourceId, sourceName, summaryEdited]);

  const save = useCallback(async () => {
    if (!proposal?.canSave || stale || !includedKeys) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`/api/resumes/${sourceId}/one-page/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(requestBody(resumeName.trim() || `${sourceName} — One-Page`)),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error?.message ?? 'The reviewed version could not be saved. Your edits are still here.');
        return;
      }
      router.push(`/resumes/${payload.resume.id}`);
    } catch {
      setMessage('We could not reach the server. Your reviewed content is still here.');
    } finally {
      setSaving(false);
    }
  }, [proposal, stale, includedKeys, sourceId, requestBody, resumeName, sourceName, router]);

  const toggleItem = (key: string) => {
    setIncludedKeys((current) => {
      const next = new Set(current ?? proposal?.includedKeys ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setStale(true);
  };

  const toggleRewrite = (rewrite: Proposal['rewrites'][number]) => {
    setAcceptedOperationIds((current) => {
      const next = new Set(current);
      if (next.has(rewrite.id)) next.delete(rewrite.id);
      else next.add(rewrite.id);
      return next;
    });
    if (rewrite.itemKey) {
      setIncludedKeys((current) => new Set([...(current ?? proposal?.includedKeys ?? []), rewrite.itemKey!]));
    }
    setStale(true);
  };

  const itemsBySection = useMemo(() => {
    const groups = new Map<string, Proposal['items']>();
    for (const item of proposal?.items ?? []) {
      const group = groups.get(item.section) ?? [];
      group.push(item);
      groups.set(item.section, group);
    }
    return Array.from(groups.entries());
  }, [proposal]);

  return (
    <section className="card-pad space-y-5" aria-labelledby="one-page-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="one-page-title" className="text-lg font-semibold text-ink">Create a one-page version</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            We rank existing content, preserve its wording, then measure the rendered PDF. Your source stays unchanged; saving creates a separate resume.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onClose} aria-label="Close one-page review">
          <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> Close
        </button>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="block min-w-0 space-y-1.5">
          <span className="text-sm font-medium text-ink">Target job</span>
          <select className="select w-full min-w-0 max-w-full truncate" value={targetJobId} onChange={(event) => { setTargetJobId(event.target.value); setStale(Boolean(proposal)); }}>
            <option value="">General version</option>
            {targetableJobs.map((job) => (
              <option key={job.id} value={job.id}>{job.title} · {job.company}</option>
            ))}
          </select>
          {targetableJobs.find((job) => job.id === targetJobId)?.hasDescription === false ? (
            <span className="block text-xs leading-relaxed text-muted">
              This job has no description saved, so tailoring can only use its title and company.
            </span>
          ) : null}
        </label>
        {!targetJobId ? (
          <label className="block min-w-0 space-y-1.5">
            <span className="text-sm font-medium text-ink">Target role (optional)</span>
            <input className="input w-full min-w-0 max-w-full" maxLength={180} value={targetRole} onChange={(event) => { setTargetRole(event.target.value); setStale(Boolean(proposal)); }} placeholder="e.g. Product Designer" />
          </label>
        ) : null}
        <label className="block min-w-0 space-y-1.5">
          <span className="text-sm font-medium text-ink">Main focus (optional)</span>
          <input className="input w-full min-w-0 max-w-full" maxLength={240} value={objective} onChange={(event) => { setObjective(event.target.value); setStale(Boolean(proposal)); }} placeholder="e.g. platform reliability" />
        </label>
        <label className="block min-w-0 space-y-1.5">
          <span className="text-sm font-medium text-ink">Template</span>
          <select className="select w-full min-w-0 max-w-full truncate" value={templateKey} onChange={(event) => { setTemplateKey(event.target.value as TemplateKey); setStale(Boolean(proposal)); }}>
            {TEMPLATE_LIST.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
          </select>
        </label>
        <label className="block min-w-0 space-y-1.5">
          <span className="text-sm font-medium text-ink">Page size</span>
          <select className="select w-full min-w-0 max-w-full truncate" value={pageSize} onChange={(event) => { setPageSize(event.target.value as PageSizeKey); setStale(Boolean(proposal)); }}>
            {Object.values(PAGE_SIZES).map((size) => <option key={size.key} value={size.key}>{size.label}</option>)}
          </select>
        </label>
      </div>

      {targetJobId && canOptimize ? (
        <label className="flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          <input type="checkbox" className="mt-1 accent-[#D4AF37]" checked={useAi} onChange={(event) => { setUseAi(event.target.checked); setStale(Boolean(proposal)); }} />
          <span>
            <span className="block font-medium text-ink">Include optional AI wording suggestions</span>
            <span className="block text-xs text-muted">Uses the existing Resume Optimization feature and may use one AI credit. Each suggestion is evidence-checked and remains optional.</span>
          </span>
        </label>
      ) : targetJobId && !canOptimize ? (
        <p className="rounded-xl bg-surface-sunken p-3 text-xs text-muted">AI suggestions use the Resume Optimization entitlement. Deterministic one-page selection remains available.</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={() => void generate()} disabled={busy || saving}>
          {busy ? <Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {proposal ? 'Update preview' : 'Prepare review'}
        </button>
        {selectedJob ? <span className="text-xs text-muted">Using {selectedJob.title} at {selectedJob.company}{selectedJob.hasDescription ? '' : ' title/company only'}.</span> : null}
      </div>

      {message ? <p className="rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-sm text-danger-text" role="alert">{message}</p> : null}

      {proposal ? (
        <div className="space-y-5 border-t border-line pt-5">
          <div className={`rounded-xl border px-4 py-3 ${proposal.canSave ? 'border-success/30 bg-success/[0.06]' : 'border-warn/30 bg-warn/[0.06]'}`} role="status" aria-live="polite">
            <p className="font-medium text-ink">
              {proposal.canSave ? `Measured PDF: exactly ${proposal.pageCount} page · readable type retained` : `Measured PDF: ${proposal.pageCount} pages · more selection is needed`}
            </p>
            <p className="mt-1 text-xs text-muted">PDF page count comes from the serialized file. The one-page layout uses a minimum 9.5 pt body size and 38 pt margins.</p>
          </div>

          {proposal.aiNotice ? <p className="rounded-xl bg-surface-sunken p-3 text-sm text-muted">{proposal.aiNotice}</p> : null}
          {proposal.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-warn-text">
              {proposal.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
            </ul>
          ) : null}

          {proposal.rewrites.length > 0 ? (
            <section className="space-y-3" aria-labelledby="rewrite-heading">
              <div>
                <h3 id="rewrite-heading" className="font-semibold text-ink">Optional AI wording suggestions</h3>
                <p className="text-xs text-muted">Compare each proposal with your source and choose which wording to use.</p>
              </div>
              {proposal.rewrites.map((rewrite) => {
                const checked = acceptedOperationIds.has(rewrite.id);
                return (
                  <label key={rewrite.id} className="block rounded-xl border border-line bg-surface p-3">
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      <input type="checkbox" className="accent-[#D4AF37]" checked={checked} onChange={() => toggleRewrite(rewrite)} />
                      Use this {rewrite.section.toLowerCase()} rewrite
                    </span>
                    <span className="mt-3 grid gap-3 md:grid-cols-2">
                      <span className="block min-w-0 rounded-lg bg-surface-sunken p-3 text-sm text-muted">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide">Source</span>{rewrite.originalText}
                      </span>
                      <span className="block min-w-0 rounded-lg bg-card p-3 text-sm text-ink">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide">Proposed</span>{rewrite.proposedText}
                      </span>
                    </span>
                    {rewrite.warnings.length > 0 ? <span className="mt-2 block text-xs text-warn-text">{rewrite.warnings.join(' ')}</span> : null}
                  </label>
                );
              })}
            </section>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.9fr)]">
            <section className="min-w-0 space-y-3" aria-labelledby="selection-heading">
              <div>
                <h3 id="selection-heading" className="font-semibold text-ink">Review retained and omitted content</h3>
                <p className="text-xs text-muted">Uncheck an included item to remove it. Check an omitted item to restore it, then update the preview.</p>
              </div>
              <div className="max-h-[34rem] space-y-2 overflow-y-auto rounded-xl border border-line p-3">
                {itemsBySection.map(([section, items]) => (
                  <details key={section} open>
                    <summary className="cursor-pointer py-2 text-sm font-semibold text-ink">{section} <span className="text-xs font-normal text-muted">{items.filter((item) => includedKeys?.has(item.key)).length}/{items.length} retained</span></summary>
                    <ul className="space-y-2 pb-3">
                      {items.map((item) => {
                        const checked = includedKeys?.has(item.key) ?? item.included;
                        return (
                          <li key={item.key}>
                            <label className="flex items-start gap-2 rounded-lg bg-surface p-2.5 text-sm">
                              <input type="checkbox" className="mt-1 shrink-0 accent-[#D4AF37]" checked={checked} onChange={() => toggleItem(item.key)} />
                              <span className="min-w-0 flex-1 break-words">
                                <span className="block font-medium text-ink">{item.label}</span>
                                {item.text ? <span className="mt-0.5 block whitespace-pre-wrap text-xs text-ink-2">{item.text}</span> : null}
                                {!checked && item.reason ? <span className="mt-1 block text-xs text-muted">{item.reason}</span> : null}
                              </span>
                            </label>
                            {checked && item.editable ? (
                              <label className="ml-7 mt-1 block">
                                <span className="sr-only">Edit {item.label}</span>
                                <textarea
                                  className="input min-h-20 w-full resize-y text-xs"
                                  maxLength={1200}
                                  value={editedItems[item.key] ?? item.text}
                                  onChange={(event) => {
                                    setEditedItems((current) => ({ ...current, [item.key]: event.target.value }));
                                    setStale(true);
                                  }}
                                />
                              </label>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ))}
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">Professional summary</span>
                <textarea
                  className="input min-h-28 w-full resize-y"
                  maxLength={2000}
                  value={summaryDraft}
                  onChange={(event) => {
                    setSummaryDraft(event.target.value);
                    setSummaryEdited(true);
                    if (includedKeys) setIncludedKeys(new Set([...includedKeys, 'summary']));
                    setStale(true);
                  }}
                />
              </label>
            </section>

            <section className="min-w-0 space-y-3" aria-labelledby="preview-heading">
              <div>
                <h3 id="preview-heading" className="font-semibold text-ink">Rendered document</h3>
                <p className="text-xs text-muted">{proposal.pageSize === 'A4' ? 'A4' : 'US Letter'} · {TEMPLATE_LIST.find((item) => item.key === proposal.templateKey)?.label}</p>
              </div>
              <div ref={previewRef} className="min-w-0 rounded-xl bg-surface-sunken p-2 sm:p-4">
                <ResumeLayoutPreview layout={proposal.layout} availableWidth={previewWidth} label="One-page resume review" />
              </div>
            </section>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink">New resume name</span>
              <input className="input w-full" maxLength={120} value={resumeName} onChange={(event) => setResumeName(event.target.value)} />
            </label>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={!proposal.canSave || stale || busy || saving}>
              {saving ? <Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <><Check className="mr-1.5 h-4 w-4" aria-hidden="true" /><Save className="mr-1.5 h-4 w-4" aria-hidden="true" /></>}
              {saving ? 'Saving…' : stale ? 'Update preview before saving' : 'Save as a new resume'}
            </button>
          </div>
          <p className="text-xs text-muted">Saving keeps “{sourceName}” and your career profile unchanged. The new version will link back to this source.</p>
        </div>
      ) : null}
    </section>
  );
}
