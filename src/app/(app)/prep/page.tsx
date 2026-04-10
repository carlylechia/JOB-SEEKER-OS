'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { JobLead, PrepPack } from '@/types';

const PREP_FIELDS: { key: keyof Omit<PrepPack, 'prepScore' | 'prepStatus'>; label: string; hint: string }[] = [
  { key: 'whyThisRole', label: 'Why this role?', hint: 'What genuinely excites you about this opportunity?' },
  { key: 'topFitPoints', label: 'Top fit points', hint: 'Your 3–5 strongest reasons you are a good match.' },
  { key: 'likelyQuestions', label: 'Likely questions', hint: 'Questions you expect to be asked and key points to cover.' },
  { key: 'questionsToAsk', label: 'Questions to ask them', hint: 'Thoughtful questions that show your depth of research.' },
  { key: 'technicalFocus', label: 'Technical focus', hint: 'Specific topics, patterns, or systems to brush up on.' },
  { key: 'companyResearchLinks', label: 'Company research / links', hint: 'Blog posts, docs, job listings, or any links worth revisiting.' },
];

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  READY: 'Ready',
};

function PrepCard({ job, onSave }: { job: JobLead; onSave: (id: string, data: PrepPack) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PrepPack>({ ...job.prepPack });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function set(field: keyof PrepPack, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(job.id, form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const statusColor: Record<string, string> = {
    NOT_STARTED: 'bg-white/10 text-white',
    IN_PROGRESS: 'bg-amber-500/15 text-amber-300',
    READY: 'bg-emerald-500/15 text-emerald-300',
  };

  return (
    <div className="card-pad space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href={`/jobs/${job.id}`} className="font-semibold hover:text-accent">{job.company}</Link>
          <div className="muted text-sm">{job.title}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${statusColor[form.prepStatus] || 'bg-white/10 text-white'}`}>
            {STATUS_LABELS[form.prepStatus] ?? form.prepStatus}
          </span>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setOpen((p) => !p)}
          >
            {open ? 'Close' : 'Edit prep pack'}
          </button>
        </div>
      </div>

      {!open && (
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <span className="text-muted">Why this role: </span>
            {job.prepPack.whyThisRole || <span className="text-muted italic">Not filled yet.</span>}
          </div>
          <div>
            <span className="text-muted">Top fit points: </span>
            {job.prepPack.topFitPoints || <span className="text-muted italic">Not filled yet.</span>}
          </div>
        </div>
      )}

      {open && (
        <form onSubmit={handleSave} className="space-y-4 border-t border-line pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-muted">Status</label>
            <select
              className="input w-auto"
              value={form.prepStatus}
              onChange={(e) => set('prepStatus', e.target.value)}
            >
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <label className="text-sm text-muted ml-auto">Score (0–100)</label>
            <input
              className="input w-24"
              type="number"
              min="0"
              max="100"
              value={form.prepScore}
              onChange={(e) => set('prepScore', Number(e.target.value))}
            />
          </div>

          {PREP_FIELDS.map(({ key, label, hint }) => (
            <div key={key}>
              <label className="text-sm font-medium block mb-1">{label}</label>
              <p className="text-xs text-muted mb-1">{hint}</p>
              <textarea
                className="input"
                rows={3}
                value={(form[key] as string) || ''}
                onChange={(e) => set(key, e.target.value)}
                placeholder={hint}
              />
            </div>
          ))}

          <div className="flex gap-3">
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save prep pack'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function PrepPage() {
  const { jobs, updatePrepPack, isLoading } = useJobs();

  if (isLoading) return <div className="card-pad">Loading prep packs…</div>;

  const interviewJobs = jobs.filter((j) => j.status === 'INTERVIEWING');
  const otherJobs = jobs.filter((j) => !['INTERVIEWING', 'ARCHIVED', 'REJECTED'].includes(j.status) && j.prepPack.prepStatus !== 'NOT_STARTED');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prep Packs"
        subtitle="Interview preparation, talking points, and company-specific notes."
      />

      {interviewJobs.length === 0 && otherJobs.length === 0 ? (
        <div className="card-pad text-center py-12">
          <div className="text-4xl mb-4">📋</div>
          <div className="text-lg font-semibold">No active Interview prep</div>
          <div className="muted mt-2 max-w-md mx-auto text-sm">
            Prep packs appear here for jobs with status <strong>Interviewing</strong>. Move a job to Interviewing to start preparing.
          </div>
          <Link href="/pipeline" className="btn-primary mt-4 inline-block">Go to pipeline</Link>
        </div>
      ) : (
        <div className="space-y-6">
          {interviewJobs.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted mb-3">Interviewing now</h2>
              <div className="space-y-4">
                {interviewJobs.map((job) => (
                  <PrepCard key={job.id} job={job} onSave={updatePrepPack} />
                ))}
              </div>
            </div>
          )}
          {otherJobs.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted mb-3">In progress</h2>
              <div className="space-y-4">
                {otherJobs.map((job) => (
                  <PrepCard key={job.id} job={job} onSave={updatePrepPack} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

