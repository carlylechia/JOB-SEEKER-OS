'use client';

import { useEffect, useMemo, useState } from 'react';
import { JobFormValues, JobLead } from '@/types';

const statuses = ['LEAD', 'SAVED', 'APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED'] as const;

function toFormValues(job?: JobLead, initialValues?: Partial<JobFormValues>): JobFormValues {
  return {
    company: initialValues?.company ?? job?.company ?? '',
    title: initialValues?.title ?? job?.title ?? '',
    source: initialValues?.source ?? job?.source ?? '',
    jobUrl: initialValues?.jobUrl ?? job?.jobUrl ?? '',
    location: initialValues?.location ?? job?.location ?? '',
    remoteType: initialValues?.remoteType ?? job?.remoteType ?? 'Remote',
    timezoneRequirement: initialValues?.timezoneRequirement ?? job?.timezoneRequirement ?? '',
    eligibilityRegion: initialValues?.eligibilityRegion ?? job?.eligibilityRegion ?? '',
    salaryMin: initialValues?.salaryMin ?? (job?.salaryMin ? String(job.salaryMin) : ''),
    salaryMax: initialValues?.salaryMax ?? (job?.salaryMax ? String(job.salaryMax) : ''),
    currency: initialValues?.currency ?? job?.currency ?? 'USD',
    notes: initialValues?.notes ?? job?.notes ?? '',
    status: initialValues?.status ?? job?.status ?? 'LEAD',
    nextFollowUp: initialValues?.nextFollowUp ?? job?.nextFollowUp ?? '',
    coreStackMatch: initialValues?.coreStackMatch ?? job?.score.coreStackMatch ?? 3,
    roleAlignment: initialValues?.roleAlignment ?? job?.score.roleAlignment ?? 3,
    seniorityFit: initialValues?.seniorityFit ?? job?.score.seniorityFit ?? 3,
    geographyEligibility: initialValues?.geographyEligibility ?? job?.score.geographyEligibility ?? 3,
    timezoneCompatibility: initialValues?.timezoneCompatibility ?? job?.score.timezoneCompatibility ?? 3,
    compensationFit: initialValues?.compensationFit ?? job?.score.compensationFit ?? 3,
    domainRelevance: initialValues?.domainRelevance ?? job?.score.domainRelevance ?? 3,
    applicationFriction: initialValues?.applicationFriction ?? job?.score.applicationFriction ?? 3,
    signalQuality: initialValues?.signalQuality ?? job?.score.signalQuality ?? 3,
  };
}

export function JobForm({
  mode,
  job,
  initialValues,
  resetToken,
  titleOptions = [],
  onCreateTitle,
  onSubmit,
  onDelete,
}: {
  mode: 'create' | 'edit';
  job?: JobLead;
  initialValues?: Partial<JobFormValues>;
  resetToken?: string;
  titleOptions?: string[];
  onCreateTitle?: (name: string) => Promise<string>;
  onSubmit: (values: JobFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [values, setValues] = useState<JobFormValues>(() => toFormValues(job, initialValues));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingTitle, setIsCreatingTitle] = useState(false);

  useEffect(() => {
    if (mode === 'create') setValues(toFormValues(undefined, initialValues));
  }, [mode, initialValues, resetToken]);

  const averageSignal = useMemo(() => {
    const total = values.coreStackMatch + values.roleAlignment + values.seniorityFit + values.geographyEligibility + values.timezoneCompatibility + values.compensationFit + values.domainRelevance + values.applicationFriction + values.signalQuality;
    return Math.round((total / 9) * 10) / 10;
  }, [values]);

  function update<K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) { setValues((prev) => ({ ...prev, [key]: value })); }

  async function maybeCreateTitle() {
    const clean = values.title.trim();
    if (!clean || !onCreateTitle || titleOptions.includes(clean)) return;
    setIsCreatingTitle(true);
    try {
      const created = await onCreateTitle(clean);
      update('title', created);
    } finally {
      setIsCreatingTitle(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true); setError(null);
    try { await onSubmit(values); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save job.'); } finally { setIsSubmitting(false); }
  }
  async function handleDelete() {
    if (!onDelete) return;
    if (!window.confirm('Archive/delete this job lead? This cannot be undone.')) return;
    setIsDeleting(true); setError(null);
    try { await onDelete(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to delete job.'); } finally { setIsDeleting(false); }
  }

  const scoreFields: Array<{ key: keyof JobFormValues; label: string }> = [
    { key: 'coreStackMatch', label: 'Core stack match' },
    { key: 'roleAlignment', label: 'Role alignment' },
    { key: 'seniorityFit', label: 'Seniority fit' },
    { key: 'geographyEligibility', label: 'Geography eligibility' },
    { key: 'timezoneCompatibility', label: 'Timezone compatibility' },
    { key: 'compensationFit', label: 'Compensation fit' },
    { key: 'domainRelevance', label: 'Domain relevance' },
    { key: 'applicationFriction', label: 'Application friction' },
    { key: 'signalQuality', label: 'Signal quality' },
  ];

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="card-pad">
            <h3 className="text-lg font-semibold">Role basics</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><label className="muted">Company</label><input className="input mt-1" value={values.company} onChange={(e) => update('company', e.target.value)} required /></div>
              <div className="md:col-span-2">
                <label className="muted">Role title</label>
                <div className="mt-1 flex gap-2">
                  <input list="job-title-options" className="input" value={values.title} onChange={(e) => update('title', e.target.value)} required />
                  {onCreateTitle && values.title.trim() && !titleOptions.includes(values.title.trim()) ? <button type="button" className="btn-secondary shrink-0" onClick={() => void maybeCreateTitle()} disabled={isCreatingTitle}>{isCreatingTitle ? 'Adding...' : 'Add title'}</button> : null}
                </div>
                <datalist id="job-title-options">{titleOptions.map((option) => <option key={option} value={option} />)}</datalist>
              </div>
              <div><label className="muted">Source</label><input className="input mt-1" value={values.source} onChange={(e) => update('source', e.target.value)} placeholder="Ashby / LinkedIn / Referral" /></div>
              <div><label className="muted">Job URL</label><input className="input mt-1" value={values.jobUrl} onChange={(e) => update('jobUrl', e.target.value)} placeholder="https://..." /></div>
              <div><label className="muted">Location</label><input className="input mt-1" value={values.location} onChange={(e) => update('location', e.target.value)} /></div>
              <div><label className="muted">Remote type</label><input className="input mt-1" value={values.remoteType} onChange={(e) => update('remoteType', e.target.value)} placeholder="Fully Remote" /></div>
              <div><label className="muted">Timezone requirement</label><input className="input mt-1" value={values.timezoneRequirement} onChange={(e) => update('timezoneRequirement', e.target.value)} /></div>
              <div><label className="muted">Eligibility region</label><input className="input mt-1" value={values.eligibilityRegion} onChange={(e) => update('eligibilityRegion', e.target.value)} /></div>
            </div>
          </div>

          <div className="card-pad">
            <h3 className="text-lg font-semibold">Application workflow</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div><label className="muted">Status</label><select className="select mt-1" value={values.status} onChange={(e) => update('status', e.target.value as JobFormValues['status'])}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>
              <div><label className="muted">Next follow-up</label><input className="input mt-1" type="date" value={values.nextFollowUp} onChange={(e) => update('nextFollowUp', e.target.value)} /></div>
              <div><label className="muted">Minimum salary</label><input className="input mt-1" type="number" min="0" value={values.salaryMin} onChange={(e) => update('salaryMin', e.target.value)} /></div>
              <div><label className="muted">Maximum salary</label><input className="input mt-1" type="number" min="0" value={values.salaryMax} onChange={(e) => update('salaryMax', e.target.value)} /></div>
              <div><label className="muted">Currency</label><input className="input mt-1" value={values.currency} onChange={(e) => update('currency', e.target.value.toUpperCase())} maxLength={6} /></div>
            </div>
            <div className="mt-4"><label className="muted">Notes</label><textarea className="input mt-1 min-h-32" value={values.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Why this role, risks, referral notes, stack clues, or tailoring reminders..." /></div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card-pad">
            <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">Scoring controls</h3><p className="muted mt-1">Use the 0–5 rubric to score fit before or after saving.</p></div><div className="rounded-xl border border-line bg-white/5 px-3 py-2 text-sm text-muted">Avg signal: <span className="text-white">{averageSignal}/5</span></div></div>
            <div className="mt-4 space-y-3">{scoreFields.map((field) => <div key={field.key} className="rounded-xl border border-line p-3"><div className="flex items-center justify-between gap-4"><label className="text-sm text-ink">{field.label}</label><select className="select w-24" value={values[field.key] as number} onChange={(e) => update(field.key, Number(e.target.value) as any)}>{[0,1,2,3,4,5].map((n)=><option key={n} value={n}>{n}</option>)}</select></div></div>)}</div>
          </div>

          <div className="card-pad space-y-3">
            <h3 className="text-lg font-semibold">Save changes</h3>
            <p className="muted">This release saves the job, recalculates fit and priority, and keeps the detail workspace up to date.</p>
            {error ? <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
            <div className="flex flex-wrap gap-3">
              <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : mode === 'create' ? 'Create job lead' : 'Save changes'}</button>
              {mode === 'edit' && onDelete ? <button type="button" className="btn-secondary border-red-400/20 text-red-200" disabled={isDeleting} onClick={() => void handleDelete()}>{isDeleting ? 'Deleting...' : 'Delete lead'}</button> : null}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
