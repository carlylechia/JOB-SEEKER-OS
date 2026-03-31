'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { defaultPreferences, parseCommaList, stringifyList } from '@/lib/preferences';
import { SeniorityLevel, UserPreferences, WorkRegion } from '@/types';

const seniorityOptions: SeniorityLevel[] = ['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE'];
const regionOptions: WorkRegion[] = ['US', 'EU', 'AFRICA', 'WORLDWIDE', 'FLEXIBLE'];

export default function SettingsPage() {
  const { preferences, updatePreferences } = useJobs();
  const [form, setForm] = useState<UserPreferences>(preferences ?? defaultPreferences);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (preferences) setForm(preferences);
  }, [preferences]);

  function setField<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    updatePreferences(form);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Personalize scoring so rankings reflect each user's level, location, salary, and stack priorities." />
      <div className="card-pad grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm text-muted">Current level</label>
          <select className="select" value={form.currentLevel} onChange={(e) => setField('currentLevel', e.target.value as SeniorityLevel)}>
            {seniorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Target level</label>
          <select className="select" value={form.targetLevel} onChange={(e) => setField('targetLevel', e.target.value as SeniorityLevel)}>
            {seniorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Target roles</label>
          <input className="input" value={stringifyList(form.targetRoles)} onChange={(e) => setField('targetRoles', parseCommaList(e.target.value))} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Preferred titles</label>
          <input className="input" value={stringifyList(form.preferredTitles)} onChange={(e) => setField('preferredTitles', parseCommaList(e.target.value))} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Preferred regions</label>
          <input className="input" value={stringifyList(form.preferredRegions)} onChange={(e) => setField('preferredRegions', parseCommaList(e.target.value))} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Preferred stack</label>
          <input className="input" value={stringifyList(form.preferredStack)} onChange={(e) => setField('preferredStack', parseCommaList(e.target.value))} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Must-have tech</label>
          <input className="input" value={stringifyList(form.mustHaveTech)} onChange={(e) => setField('mustHaveTech', parseCommaList(e.target.value))} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Work-region overlap</label>
          <select className="select" multiple value={form.workRegions} onChange={(e) => setField('workRegions', Array.from(e.target.selectedOptions).map((option) => option.value as WorkRegion))}>
            {regionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <p className="mt-2 muted">Hold Cmd/Ctrl to select multiple.</p>
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Minimum monthly salary (USD)</label>
          <input className="input" type="number" value={form.salaryMin} onChange={(e) => setField('salaryMin', Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Target monthly salary (USD)</label>
          <input className="input" type="number" value={form.salaryTarget} onChange={(e) => setField('salaryTarget', Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Timezone tolerance (hours)</label>
          <input className="input" type="number" min={0} max={12} value={form.timezoneToleranceHours} onChange={(e) => setField('timezoneToleranceHours', Number(e.target.value) || 0)} />
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
          <input id="remoteOnly" type="checkbox" checked={form.remoteOnly} onChange={(e) => setField('remoteOnly', e.target.checked)} />
          <label htmlFor="remoteOnly" className="text-sm text-ink">Only rank remote-friendly roles highly</label>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={handleSave}>Save preferences</button>
        {saved ? <span className="text-sm text-emerald-300">Preferences saved. Rankings will update automatically.</span> : null}
      </div>
    </div>
  );
}
