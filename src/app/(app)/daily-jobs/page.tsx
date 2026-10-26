'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, RefreshCw, Save, ExternalLink, XCircle } from 'lucide-react';

type RecJob = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string | null;
  workArrangement: string | null;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  publishedAt: string | null;
  lastVerifiedAt: string | null;
  applicationUrl: string | null;
  source: string;
  attribution: string | null;
  status: string;
};

type Rec = {
  id: string;
  rank: number;
  fitScore: number;
  confidence: number | null;
  scoreBreakdown: any;
  explanation: any;
  status: string;
  job: RecJob;
};

export default function DailyJobsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('no_run');
  const [run, setRun] = useState<any>(null);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/job-discovery/recommendations');
      if (res.status === 403) {
        setError('This feature requires a Pro plan.');
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setStatus(data.status);
      setRun(data.run);
      setRecs(data.recommendations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/job-discovery/run', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Refresh failed');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function save(rec: Rec) {
    setSavingId(rec.id);
    try {
      const res = await fetch(`/api/job-discovery/recommendations/${rec.id}/save`, { method: 'POST' });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      setRecs((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: 'SAVED' } : r)));
      if (data.jobId) {
        router.push(`/jobs/${data.jobId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingId(null);
    }
  }

  async function dismiss(rec: Rec) {
    await fetch(`/api/job-discovery/recommendations/${rec.id}/dismiss`, { method: 'POST' });
    setRecs((prev) => prev.filter((r) => r.id !== rec.id));
  }

  if (loading) {
    return <div className="p-8 text-muted">Loading your daily recommendations…</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-line bg-surface p-6 text-ink">
          <p className="font-medium">{error}</p>
          {error.includes('Pro plan') ? (
            <button className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm text-accent-ink" onClick={() => router.push('/settings/billing')}>View plans</button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink">
            <Sparkles className="h-6 w-6 text-accent" />
            Daily Top 5
          </h1>
          <p className="text-sm text-muted">
            {run ? `Generated ${new Date(run.completedAt ?? run.startedAt).toLocaleString()}` : 'No run yet'}
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm text-accent-ink disabled:opacity-50">
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {status === 'no_run' ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-muted">
          No recommendations yet. Click Refresh to run discovery.
        </div>
      ) : null}

      {recs.length === 0 && status !== 'no_run' ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-muted">
          No qualifying jobs found in the latest run. Try updating your profile and preferences.
        </div>
      ) : null}

      <div className="grid gap-4">
        {recs.map((rec) => (
          <div key={rec.id} className="rounded-xl border border-line bg-surface p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">#{rec.rank}</span>
                  <h2 className="text-lg font-semibold text-ink">{rec.job.title}</h2>
                </div>
                <p className="text-sm text-muted">{rec.job.company}{rec.job.location ? ` · ${rec.job.location}` : ''}</p>
                <div className="flex flex-wrap gap-2 text-xs text-muted">
                  {rec.job.remoteType ? <span>{rec.job.remoteType}</span> : null}
                  {rec.job.employmentType ? <span>{rec.job.employmentType}</span> : null}
                  {rec.job.salaryMin || rec.job.salaryMax ? (
                    <span>{rec.job.salaryMin ?? '?'}–{rec.job.salaryMax ?? '?'} {rec.job.currency}</span>
                  ) : null}
                  {rec.job.publishedAt ? <span>Published {new Date(rec.job.publishedAt).toLocaleDateString()}</span> : null}
                  <span>Source: {rec.job.source}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-ink">{Math.round(rec.fitScore)}</div>
                <div className="text-xs text-muted">Fit score</div>
                {rec.confidence != null ? (
                  <div className="text-xs text-muted">Confidence {Math.round(rec.confidence * 100)}%</div>
                ) : null}
              </div>
            </div>

            {Array.isArray(rec.explanation?.reasons) ? (
              <ul className="mt-3 list-disc pl-5 text-sm text-muted">
                {rec.explanation.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
              </ul>
            ) : null}

            {rec.scoreBreakdown ? (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer">Score breakdown</summary>
                <pre className="mt-2 overflow-auto rounded bg-surface-sunken p-2">{JSON.stringify(rec.scoreBreakdown, null, 2)}</pre>
              </details>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {rec.job.applicationUrl ? (
                <a href={rec.job.applicationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-sunken">
                  <ExternalLink className="h-4 w-4" /> Open application
                </a>
              ) : null}
              {rec.status !== 'SAVED' ? (
                <button onClick={() => save(rec)} disabled={savingId === rec.id} className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-ink disabled:opacity-50">
                  <Save className="mr-1 h-4 w-4" /> {savingId === rec.id ? 'Saving…' : 'Add to My Jobs'}
                </button>
              ) : (
                <span className="text-sm text-green-600">Saved to workspace</span>
              )}
              <button onClick={() => dismiss(rec)} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-sunken">
                <XCircle className="h-4 w-4" /> Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
