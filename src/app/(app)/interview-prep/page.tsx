'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, FileText, Plus, Search, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import type { PackSummary } from '@/components/interview-prep/types';

type Access = {
  canGenerate: boolean;
  plan: string;
  aiCreditsRemaining: number | null;
};

type ListEnvelope = {
  packs: PackSummary[];
  access: Access;
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-surface-sunken text-muted',
  RESEARCHING: 'bg-[rgb(var(--info-text)/0.15)] text-info-text',
  GENERATING: 'bg-[rgb(var(--info-text)/0.15)] text-info-text',
  READY: 'bg-success/15 text-success-text',
  PARTIALLY_READY: 'bg-warn/15 text-warn-text',
  FAILED: 'bg-danger/15 text-danger-text',
  ARCHIVED: 'bg-muted/10 text-muted',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  RESEARCHING: 'Researching',
  GENERATING: 'Generating',
  READY: 'Ready',
  PARTIALLY_READY: 'Partially ready',
  FAILED: 'Needs attention',
  ARCHIVED: 'Archived',
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function InterviewDate({ at }: { at: string | null }) {
  if (!at) return <span className="text-muted">No interview date set</span>;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return <span className="text-muted">No interview date set</span>;
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  return (
    <span className={days <= 3 && days >= 0 ? 'font-medium text-warn-text' : ''}>
      <CalendarDays className="mr-1 inline h-3.5 w-3.5" aria-hidden />
      {date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}
      {days >= 0 && days <= 14 ? ` · in ${days === 0 ? 'today' : `${days}d`}` : ''}
    </span>
  );
}

export default function InterviewPrepPage() {
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [access, setAccess] = useState<Access | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/interview-prep?includeArchived=${includeArchived}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Could not load preparation packs.');
      const json = (await res.json()) as ListEnvelope;
      setPacks(json.packs);
      setAccess(json.access);
    } catch {
      setError('We could not load your preparation packs. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = packs.filter((pack) =>
    `${pack.company} ${pack.roleTitle} ${pack.title}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Interview prep"
        subtitle="Employer-specific preparation packs built from the job, your evidence and the sources you trust."
        action={
          <Link className="btn-primary" href="/interview-prep/new">
            <Plus className="mr-1 inline h-4 w-4" aria-hidden />
            New prep pack
          </Link>
        }
      />

      {access && !access.canGenerate ? (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.08] p-4">
          <p className="text-sm font-medium text-ink">
            {access.plan === 'FREE'
              ? 'Interview preparation is a Pro feature.'
              : 'Your current plan does not include new interview packs.'}
          </p>
          <p className="muted mt-1">
            You can still open and practise packs you already created. New generation uses AI credits.
          </p>
          <Link className="btn-secondary mt-3 inline-flex text-sm" href="/settings/billing">
            View plans
          </Link>
        </div>
      ) : null}

      <div className="card-pad flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
          <input
            className="input pl-9"
            placeholder="Search company, role, or pack title"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Show archived
        </label>
      </div>

      {error ? (
        <div className="rounded-xl border border-danger/25 bg-danger/[0.06] p-4 text-sm">{error}</div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-52 animate-pulse rounded-2xl bg-surface-sunken" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-pad py-14 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent-text">
            <FileText className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="text-lg font-semibold">
            {packs.length === 0 ? 'No preparation packs yet' : 'No packs match that search'}
          </h2>
          <p className="muted mx-auto mt-2 max-w-md">
            {packs.length === 0
              ? 'Create a pack from a saved job or paste a role you are preparing for. We will build a briefing, research notes, questions, a plan and a mock interview.'
              : 'Try a different company or role, or clear the search.'}
          </p>
          {packs.length === 0 ? (
            <Link className="btn-primary mt-4 inline-flex" href="/interview-prep/new">
              <Sparkles className="mr-1 h-4 w-4" aria-hidden />
              Build your first pack
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((pack) => {
            const archived = pack.status === 'ARCHIVED';
            return (
              <article key={pack.id} className="card-pad flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium uppercase tracking-wide text-muted">
                      {pack.company}
                    </p>
                    <h2 className="mt-1 line-clamp-2 text-base font-semibold text-ink">
                      {pack.roleTitle}
                    </h2>
                    {pack.title !== `${pack.company} — ${pack.roleTitle}`.trim() ? (
                      <p className="muted mt-1 line-clamp-2 text-xs">{pack.title}</p>
                    ) : null}
                  </div>
                  <span className={`badge shrink-0 ${STATUS_STYLES[pack.status] ?? 'bg-surface-sunken text-muted'}`}>
                    {STATUS_LABELS[pack.status] ?? pack.status}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-muted">
                  <div className="flex items-center gap-2">
                    <InterviewDate at={pack.interviewAt} />
                  </div>
                  <div>
                    {pack.questionCount} question{pack.questionCount === 1 ? '' : 's'} ·{' '}
                    {pack.practicedCount} practised · {pack.feedbackCount} with feedback
                  </div>
                  <div>
                    {pack.researchStatus === 'COMPLETED'
                      ? 'Company research included'
                      : pack.researchStatus === 'PARTIAL'
                        ? 'Some research sources used'
                        : pack.researchStatus === 'NOT_AVAILABLE'
                          ? 'Job description and profile only'
                          : pack.researchStatus === 'FAILED'
                            ? 'Research could not be read'
                            : 'Research not started'}
                    {pack.lastActivityAt ? ` · updated ${formatDate(pack.lastActivityAt)}` : ''}
                  </div>
                </div>

                <div className="mt-auto flex items-center gap-2">
                  <Link className="btn-primary flex-1 text-sm" href={`/interview-prep/${pack.id}`}>
                    {archived ? 'Review pack' : pack.status === 'DRAFT' || pack.status === 'FAILED' ? 'Continue setup' : 'Open pack'}
                    <ArrowRight className="ml-1 inline h-4 w-4" aria-hidden />
                  </Link>
                  {pack.jobId ? (
                    <Link className="btn-secondary text-sm" href={`/jobs/${pack.jobId}`}>
                      Job
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
