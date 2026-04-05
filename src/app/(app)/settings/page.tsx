'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { defaultPreferences, defaultTimezoneOptions } from '@/lib/preferences';
import { SeniorityLevel, UserPreferences, WorkRegion } from '@/types';
import { MultiSelectCombobox } from '@/components/shared/multi-select-combobox';

const seniorityOptions: SeniorityLevel[] = ['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE'];
const regionOptions: WorkRegion[] = ['US', 'EU', 'AFRICA', 'WORLDWIDE', 'FLEXIBLE'];
const preferredRegionOptions = ['Africa', 'Europe', 'EMEA', 'LATAM', 'Worldwide', 'United States', 'Remote-first'];
const stackOptions = ['TypeScript', 'JavaScript', 'Next.js', 'React', 'Node.js', 'NestJS', 'PostgreSQL', 'Docker', 'Redis', 'AWS', 'GCP'];

export default function SettingsPage() {
  const { preferences, updatePreferences, titleOptions, createTitle } = useJobs();
  const [form, setForm] = useState<UserPreferences>(preferences ?? defaultPreferences);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (preferences) setForm(preferences);
  }, [preferences]);

  function setField<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    await updatePreferences(form);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Control what kinds of roles you want to pursue so scoring compares real preferences against the jobs you save." />
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

        <MultiSelectCombobox label="Primary job titles" values={form.targetRoles} options={titleOptions} onChange={(values) => setField('targetRoles', values)} onCreateOption={createTitle} placeholder="Software Engineer" limit={5} />
        <MultiSelectCombobox label="Preferred titles / adjacent matches" values={form.preferredTitles} options={titleOptions} onChange={(values) => setField('preferredTitles', values)} onCreateOption={createTitle} placeholder="Product Engineer" limit={6} />
        <MultiSelectCombobox label="Preferred regions" values={form.preferredRegions} options={preferredRegionOptions} onChange={(values) => setField('preferredRegions', values)} placeholder="Africa" limit={5} />
        <MultiSelectCombobox label="Preferred stack" values={form.preferredStack} options={stackOptions} onChange={(values) => setField('preferredStack', values)} placeholder="TypeScript" limit={10} />
        <MultiSelectCombobox label="Must-have tech" values={form.mustHaveTech} options={stackOptions} onChange={(values) => setField('mustHaveTech', values)} placeholder="Node.js" limit={6} />
        <MultiSelectCombobox label="Timezone matches" values={form.timezoneMatches} options={defaultTimezoneOptions} onChange={(values) => setField('timezoneMatches', values)} placeholder="CET overlap" limit={5} />

        <div>
          <label className="mb-2 block text-sm text-muted">Work-region overlap</label>
          <select className="select min-h-32" multiple value={form.workRegions} onChange={(e) => setField('workRegions', Array.from(e.target.selectedOptions).map((option) => option.value as WorkRegion))}>
            {regionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <p className="mt-2 muted">Hold Cmd/Ctrl to select multiple regions.</p>
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
        <button className="btn-primary" onClick={() => void handleSave()}>Save preferences</button>
        {saved ? <span className="text-sm text-emerald-300">Preferences saved. Job scoring will use these settings immediately.</span> : null}
      </div>
    </div>
  );
}
