'use client';

import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  Loader2,
  MessageSquareText,
  Mic,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import {
  INTERVIEW_CONTEXT_DESCRIPTIONS,
  INTERVIEW_CONTEXT_LABELS,
  type InterviewContext,
} from '@/lib/interview-prep/schema';
import type { PackDetail } from './types';
import {
  BriefingSection,
  CompanySection,
  EvidenceSection,
  RoleSection,
  SourcesSection,
  headerSubtitle,
} from './sections';
import { CheatSheetTab } from './cheat-sheet';
import { PlanTab } from './plan-tab';
import { MockTab, QuestionsTab } from './practice-tab';
import { Card, Pill, SectionHeading, formatLongDate } from './ui';

type TabKey =
  | 'briefing'
  | 'company'
  | 'role'
  | 'evidence'
  | 'questions'
  | 'plan'
  | 'mock'
  | 'cheat-sheet'
  | 'sources';

const TABS: Array<{ key: TabKey; label: string; icon: typeof BookOpen }> = [
  { key: 'briefing', label: 'Briefing', icon: BookOpen },
  { key: 'company', label: 'Company', icon: Building2 },
  { key: 'role', label: 'Role', icon: Target },
  { key: 'evidence', label: 'Evidence', icon: Users },
  { key: 'questions', label: 'Questions', icon: MessageSquareText },
  { key: 'plan', label: 'Plan', icon: ClipboardList },
  { key: 'mock', label: 'Mock interview', icon: Mic },
  { key: 'cheat-sheet', label: 'Cheat sheet', icon: FileText },
  { key: 'sources', label: 'Sources', icon: ShieldCheck },
];

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  RESEARCHING: 'Researching',
  GENERATING: 'Generating',
  READY: 'Ready',
  PARTIALLY_READY: 'Partially ready',
  FAILED: 'Needs attention',
  ARCHIVED: 'Archived',
};

const STATUS_TONES: Record<string, 'neutral' | 'success' | 'warn' | 'danger' | 'info'> = {
  DRAFT: 'neutral',
  RESEARCHING: 'info',
  GENERATING: 'info',
  READY: 'success',
  PARTIALLY_READY: 'warn',
  FAILED: 'danger',
  ARCHIVED: 'neutral',
};

const RESEARCH_LABELS: Record<string, string> = {
  NOT_STARTED: 'Research not started',
  COMPLETED: 'Research complete',
  PARTIAL: 'Partial research',
  NOT_AVAILABLE: 'No research sources',
  FAILED: 'Research unavailable',
};

function toDatetimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-danger/25 bg-danger/[0.06] p-4 text-sm text-ink">
      <AlertTriangle className="mr-1 inline h-4 w-4 text-danger-text" aria-hidden />
      {message}
    </div>
  );
}

export function PackWorkspace({ packId }: { packId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<PackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [tab, setTab] = useState<TabKey>('briefing');
  const [generating, setGenerating] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/interview-prep/${packId}`, { cache: 'no-store' });
      if (res.status === 404) {
        notFound();
        return;
      }
      if (!res.ok) {
        setError('We could not load this preparation pack.');
        return;
      }
      const json = (await res.json()) as PackDetail;
      setDetail(json);
      setError('');
    } catch {
      setError('We could not load this preparation pack. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [packId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    if (!detail) return;
    const needsConfirmation = detail.data.content !== null;
    if (
      needsConfirmation &&
      !window.confirm(
        'Regenerating builds a new pack from the current inputs and uses one AI credit. Saved practice answers and feedback are kept, but the new question set may differ. Continue?',
      )
    ) {
      return;
    }
    setGenerating(true);
    setActionError('');
    try {
      const res = await fetch(`/api/interview-prep/${packId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setActionError(json.error?.message ?? 'The pack could not be generated.');
        return;
      }
      await load();
      setTab('briefing');
    } catch {
      setActionError('The pack could not be generated. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function archive() {
    if (!detail) return;
    if (!window.confirm('Archive this preparation pack? Practice history is kept and the pack can be reviewed later from the archived list.')) {
      return;
    }
    setArchiving(true);
    setActionError('');
    try {
      const res = await fetch(`/api/interview-prep/${packId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ARCHIVED' }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setActionError(json.error?.message ?? 'The pack could not be archived.');
        return;
      }
      router.push('/interview-prep');
    } catch {
      setActionError('The pack could not be archived. Please try again.');
    } finally {
      setArchiving(false);
    }
  }

  async function restore() {
    setActionError('');
    try {
      const res = await fetch(`/api/interview-prep/${packId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DRAFT' }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setActionError(json.error?.message ?? 'The pack could not be restored.');
        return;
      }
      await load();
    } catch {
      setActionError('The pack could not be restored.');
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-2xl bg-surface-sunken" />
        <div className="h-64 animate-pulse rounded-2xl bg-surface-sunken" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Link className="btn-secondary text-sm" href="/interview-prep">
          <ArrowLeft className="mr-1 inline h-4 w-4" aria-hidden />
          Back to prep packs
        </Link>
        <ErrorPanel message={error || 'Preparation pack not found.'} />
      </div>
    );
  }

  const { pack, data, readiness } = detail;
  const isDraft = pack.status === 'DRAFT' && !data.content;
  const hasContent = data.content !== null;
  const isArchived = pack.status === 'ARCHIVED';
  const needsGenerate = !hasContent || pack.status === 'FAILED';

  return (
    <div className="space-y-5 pb-10">
      <Link className="btn-secondary text-sm" href="/interview-prep">
        <ArrowLeft className="mr-1 inline h-4 w-4" aria-hidden />
        All prep packs
      </Link>

      <div className="rounded-2xl border border-line bg-gradient-to-r from-surface-sunken via-card to-card p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={STATUS_TONES[pack.status] ?? 'neutral'}>
                {STATUS_LABELS[pack.status] ?? pack.status}
              </Pill>
              <Pill tone={pack.researchStatus === 'COMPLETED' ? 'success' : pack.researchStatus === 'PARTIAL' ? 'warn' : 'neutral'}>
                {RESEARCH_LABELS[pack.researchStatus] ?? pack.researchStatus}
              </Pill>
              {readiness.level ? <Pill tone="accent">{readiness.levelLabel}</Pill> : null}
              {pack.isFresh ? null : <Pill tone="warn">Inputs changed</Pill>}
            </div>
            <PageHeader
              title={pack.title}
              subtitle={headerSubtitle(detail)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
              <span>
                <Mic className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                {INTERVIEW_CONTEXT_LABELS[data.interviewFormat] ?? data.interviewFormat}
              </span>
              {data.interviewAt ? (
                <span>
                  <CalendarDays className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  {formatLongDate(data.interviewAt)}
                </span>
              ) : (
                <span>No interview date set</span>
              )}
              {data.interviewLanguage ? <span>Language: {data.interviewLanguage}</span> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setShowSettings((current) => !current)}
            >
              <Settings2 className="mr-1 inline h-4 w-4" aria-hidden />
              {showSettings ? 'Hide settings' : 'Settings'}
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => void generate()}
              disabled={generating || isArchived}
            >
              {generating ? (
                <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="mr-1 inline h-4 w-4" aria-hidden />
              )}
              {generating ? 'Generating…' : needsGenerate ? 'Generate pack' : 'Regenerate'}
            </button>
            {isArchived ? (
              <button type="button" className="btn-secondary text-sm" onClick={() => void restore()}>
                Restore as draft
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => void archive()}
                disabled={archiving}
              >
                {archiving ? (
                  <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Archive className="mr-1 inline h-4 w-4" aria-hidden />
                )}
                Archive
              </button>
            )}
            {pack.jobId ? (
              <Link className="btn-secondary text-sm" href={`/jobs/${pack.jobId}`}>
                Open job
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {actionError ? <ErrorPanel message={actionError} /> : null}

      {isArchived ? (
        <div className="rounded-xl border border-line bg-surface-sunken p-3 text-sm">
          This pack is archived. You can review it and practise, but regenerate is disabled until you restore
          it.
        </div>
      ) : null}

      {!pack.isFresh && hasContent ? (
        <div className="flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>
            <AlertTriangle className="mr-1 inline h-4 w-4 text-warn-text" aria-hidden />
            Your profile or job details changed after this pack was generated. The saved pack is unchanged.
          </span>
          <button type="button" className="btn-secondary text-xs" onClick={() => void generate()} disabled={generating}>
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Regenerate
          </button>
        </div>
      ) : null}

      {needsGenerate ? (
        <Card className="space-y-3 border-accent/30 bg-accent/[0.04]">
          <SectionHeading
            title={isDraft ? 'Complete the setup, then generate' : 'This pack needs to be generated'}
            description={
              isDraft
                ? 'Add the interview details and any official company sources, then build the pack. If you already have a job description, generation uses it as the primary source.'
                : 'The last generation did not complete. Check the job description and sources, then try again. No practice history is lost.'
            }
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary text-sm" onClick={() => void generate()} disabled={generating}>
              {generating ? (
                <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="mr-1 inline h-4 w-4" aria-hidden />
              )}
              {generating ? 'Generating…' : 'Generate preparation pack'}
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={() => setShowSettings(true)}>
              Edit details and sources
            </button>
          </div>
          <p className="muted text-xs">
            Generation uses one AI credit from your shared monthly allowance. Reading and practising saved
            content is free.
          </p>
        </Card>
      ) : null}

      {showSettings ? (
        <PackSettings packId={packId} detail={detail} onSaved={load} onError={setActionError} />
      ) : null}

      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-line bg-card p-1 shadow-soft">
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                active ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-sunken hover:text-ink'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'briefing' ? <BriefingSection detail={detail} /> : null}
      {tab === 'company' ? <CompanySection detail={detail} /> : null}
      {tab === 'role' ? <RoleSection detail={detail} /> : null}
      {tab === 'evidence' ? <EvidenceSection detail={detail} /> : null}
      {tab === 'questions' ? <QuestionsTab detail={detail} onChanged={load} /> : null}
      {tab === 'plan' ? <PlanTab detail={detail} onChanged={load} onError={setActionError} /> : null}
      {tab === 'mock' ? <MockTab detail={detail} onChanged={load} /> : null}
      {tab === 'cheat-sheet' ? <CheatSheetTab detail={detail} /> : null}
      {tab === 'sources' ? <SourcesSection detail={detail} /> : null}
    </div>
  );
}

function PackSettings({
  packId,
  detail,
  onSaved,
  onError,
}: {
  packId: string;
  detail: PackDetail;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const data = detail.data;
  const [interviewAt, setInterviewAt] = useState(toDatetimeLocal(data.interviewAt));
  const [context, setContext] = useState<InterviewContext>(data.interviewFormat);
  const [interviewLanguage, setInterviewLanguage] = useState(data.interviewLanguage ?? '');
  const [interviewerInfo, setInterviewerInfo] = useState(data.interviewerInfo ?? '');
  const [concerns, setConcerns] = useState(data.concerns ?? '');
  const [focusTopics, setFocusTopics] = useState(data.focusTopics.join(', '));
  const [companyWebsiteUrl, setCompanyWebsiteUrl] = useState(data.companyWebsiteUrl ?? '');
  const [careersUrl, setCareersUrl] = useState(data.careersUrl ?? '');
  const [researchUrls, setResearchUrls] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setInterviewAt(toDatetimeLocal(data.interviewAt));
    setContext(data.interviewFormat);
    setInterviewLanguage(data.interviewLanguage ?? '');
    setInterviewerInfo(data.interviewerInfo ?? '');
    setConcerns(data.concerns ?? '');
    setFocusTopics(data.focusTopics.join(', '));
    setCompanyWebsiteUrl(data.companyWebsiteUrl ?? '');
    setCareersUrl(data.careersUrl ?? '');
  }, [data]);

  // Research URLs are not returned separately; load the detail source list into
  // the textarea on first render so saving does not silently erase them.
  useEffect(() => {
    const fetched = detail.sources
      .filter((source) => source.url && source.kind !== 'JOB_DESCRIPTION' && source.kind !== 'USER_NOTES')
      .map((source) => source.url as string);
    setResearchUrls(fetched.join('\n'));
  }, [detail.sources]);

  async function save() {
    setSaving(true);
    onError('');
    try {
      const urls = researchUrls
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
      const res = await fetch(`/api/interview-prep/${packId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interviewAt: interviewAt ? new Date(interviewAt).toISOString() : null,
          interviewFormat: context,
          context,
          interviewLanguage: interviewLanguage.trim() || null,
          interviewerInfo: interviewerInfo.trim() || null,
          concerns: concerns.trim() || null,
          focusTopics: focusTopics
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .slice(0, 8),
          companyWebsiteUrl: companyWebsiteUrl.trim() || null,
          careersUrl: careersUrl.trim() || null,
          researchUrls: urls,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        onError(json.error?.message ?? 'The details could not be saved.');
        return;
      }
      await onSaved();
    } catch {
      onError('The details could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4">
      <SectionHeading
        title="Pack settings"
        description="Change the interview context, date and research sources. The saved pack does not change until you regenerate; the plan is re-scheduled when the date moves."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Interview date and time</span>
          <input
            className="input"
            type="datetime-local"
            value={interviewAt}
            onChange={(event) => setInterviewAt(event.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Interview format</span>
          <select
            className="input"
            value={context}
            onChange={(event) => setContext(event.target.value as InterviewContext)}
          >
            {(Object.keys(INTERVIEW_CONTEXT_LABELS) as InterviewContext[]).map((value) => (
              <option key={value} value={value}>
                {INTERVIEW_CONTEXT_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">{INTERVIEW_CONTEXT_DESCRIPTIONS[context]}</span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Interview language</span>
          <input
            className="input"
            value={interviewLanguage}
            onChange={(event) => setInterviewLanguage(event.target.value)}
            placeholder="e.g. English, French"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Focus topics</span>
          <input
            className="input"
            value={focusTopics}
            onChange={(event) => setFocusTopics(event.target.value)}
            placeholder="Comma separated"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Interviewer or panel</span>
        <input
          className="input"
          value={interviewerInfo}
          onChange={(event) => setInterviewerInfo(event.target.value)}
          placeholder="Names, roles, or context you know"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Concerns to prepare around</span>
        <textarea
          className="input"
          rows={2}
          value={concerns}
          onChange={(event) => setConcerns(event.target.value)}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Company website</span>
          <input
            className="input"
            type="url"
            value={companyWebsiteUrl}
            onChange={(event) => setCompanyWebsiteUrl(event.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Careers page</span>
          <input
            className="input"
            type="url"
            value={careersUrl}
            onChange={(event) => setCareersUrl(event.target.value)}
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Additional official research URLs (one per line)</span>
        <textarea
          className="input"
          rows={3}
          value={researchUrls}
          onChange={(event) => setResearchUrls(event.target.value)}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary text-sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
          Save settings
        </button>
        <span className="text-xs text-muted">Regenerate after saving to apply new inputs to the pack.</span>
      </div>
    </Card>
  );
}
