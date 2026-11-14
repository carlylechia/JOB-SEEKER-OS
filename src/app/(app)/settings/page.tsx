'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { defaultPreferences, defaultTimezoneOptions, parseCommaList, stringifyList } from '@/lib/preferences';
import { SeniorityLevel, UserPreferences, WorkRegion } from '@/types';
import { MultiSelectCombobox } from '@/components/shared/multi-select-combobox';
import { ThemePicker } from '@/components/shared/theme-picker';
import Link from 'next/link';
import {
  Settings as SettingsIcon,
  SlidersHorizontal,
  MapPin,
  Code2,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';

const seniorityOptions: SeniorityLevel[] = ['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE'];
const regionOptions: WorkRegion[] = ['US', 'EU', 'AFRICA', 'WORLDWIDE', 'FLEXIBLE'];
const employmentTypeOptions = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY', 'VOLUNTEER'];
const preferredRegionOptions = ['Africa', 'Europe', 'EMEA', 'LATAM', 'Worldwide', 'United States', 'Remote-first'];
const stackOptions = ['TypeScript', 'JavaScript', 'Next.js', 'React', 'Node.js', 'NestJS', 'PostgreSQL', 'Docker', 'Redis', 'AWS', 'GCP'];

export default function SettingsPage() {
  const { preferences, updatePreferences, titleOptions, createTitle } = useJobs();
  const [form, setForm] = useState<UserPreferences>(preferences ?? defaultPreferences);
  const [saved, setSaved] = useState(false);
  const [resume, setResume] = useState<{ headline: string | null; location: string | null; skills: string[] } | null>(null);

  useEffect(() => {
    if (preferences) setForm(preferences);
  }, [preferences]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/resumes', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const first = Array.isArray(data?.resumes) ? data.resumes[0] : null;
        const content = first?.content ?? {};
        const basics = (content?.basics ?? {}) as { headline?: string | null; location?: string | null };
        const skills = Array.isArray(content?.skills)
          ? content.skills.map((skill: { name?: string }) => skill?.name).filter(Boolean)
          : [];
        if (!cancelled) {
          setResume({
            headline: basics.headline ?? first?.name ?? null,
            location: basics.location ?? null,
            skills,
          });
        }
      } catch {
        // Non-critical: settings still works without resume data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function populateFromResume() {
    if (!resume) return;
    setSaved(false);
    setForm((prev) => ({
      ...prev,
      targetRoles: prev.targetRoles.length ? prev.targetRoles : resume.headline ? [resume.headline] : prev.targetRoles,
      preferredStack: prev.preferredStack.length ? prev.preferredStack : resume.skills.slice(0, 10),
      mustHaveTech: prev.mustHaveTech.length ? prev.mustHaveTech : resume.skills.slice(0, 6),
    }));
  }

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
      <PageHeader
        title="Settings"
        subtitle="Control what kinds of roles you want to pursue so scoring compares real preferences against the jobs you save."
      />

      {resume ? (
        <section className="card-pad" aria-labelledby="resume-source-heading">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 id="resume-source-heading" className="text-base font-semibold text-ink">
                Populated from your resume
              </h2>
              <p className="muted mt-1">
                {resume.headline ?? 'Resume on file'}
                {resume.location ? ` · ${resume.location}` : ''}
                {resume.skills.length ? ` · ${resume.skills.length} skills detected` : ''}
              </p>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={populateFromResume}>
              Apply resume data to settings
            </button>
          </div>
        </section>
      ) : null}

      <section className="card-pad" aria-labelledby="appearance-heading">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-sunken text-accent-text">
            <SettingsIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 id="appearance-heading" className="text-base font-semibold text-ink">
              Appearance
            </h2>
            <p className="muted mt-1 mb-5">Switch between the light and dark interface.</p>
            <ThemePicker />
          </div>
        </div>
      </section>

      <section className="card-pad" aria-labelledby="role-targets-heading">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-sunken text-accent-text">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="role-targets-heading" className="text-base font-semibold text-ink">
              Role targets
            </h2>
            <p className="muted mt-1 mb-5">
              The titles, levels and regions that drive fit scoring. Keep these tight — they are the strongest signal.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
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
            </div>
          </div>
        </div>
      </section>

      <section className="card-pad" aria-labelledby="skills-heading">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-sunken text-accent-text">
            <Code2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="skills-heading" className="text-base font-semibold text-ink">
              Skills & stack
            </h2>
            <p className="muted mt-1 mb-5">
              Your preferred stack and must-have tech. Skills suggested from job postings and job intelligence land in your
              career profile first, where you can refine them with AI before promoting them here.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <MultiSelectCombobox label="Preferred stack" values={form.preferredStack} options={stackOptions} onChange={(values) => setField('preferredStack', values)} placeholder="TypeScript" limit={10} />
              <MultiSelectCombobox label="Must-have tech" values={form.mustHaveTech} options={stackOptions} onChange={(values) => setField('mustHaveTech', values)} placeholder="Node.js" limit={6} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href="/career-profile" className="btn-secondary text-xs">
                Refine skills with AI
              </Link>
              <Link href="/studio" className="btn-secondary text-xs">
                Open Application Studio
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="card-pad" aria-labelledby="location-heading">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-sunken text-accent-text">
            <MapPin className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="location-heading" className="text-base font-semibold text-ink">
              Location, compensation & eligibility
            </h2>
            <p className="muted mt-1 mb-5">Salary, timezone and region constraints used to filter and score roles.</p>
            <div className="grid gap-4 md:grid-cols-2">
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
              <div>
                <label className="mb-2 block text-sm text-muted">Primary timezone (IANA)</label>
                <input className="input" type="text" placeholder="UTC, America/New_York, Europe/London" value={form.timezone ?? 'UTC'} onChange={(e) => setField('timezone', e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-muted">Work countries (ISO alpha-2 codes)</label>
                <input className="input" type="text" placeholder="US, CA, GB, DE" value={stringifyList(form.workCountries ?? [])} onChange={(e) => setField('workCountries', parseCommaList(e.target.value))} />
                <p className="mt-1 text-xs text-muted">Leave empty to accept all countries.</p>
              </div>
              <div>
                <label className="mb-2 block text-sm text-muted">Preferred industries</label>
                <input className="input" type="text" placeholder="Technology, Financial services, Healthcare" value={stringifyList(form.preferredIndustries ?? [])} onChange={(e) => setField('preferredIndustries', parseCommaList(e.target.value))} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-muted">Employment types</label>
                <select className="select min-h-24" multiple value={form.employmentTypes ?? []} onChange={(e) => setField('employmentTypes', Array.from(e.target.selectedOptions).map((option) => option.value))}>
                  {employmentTypeOptions.map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}
                </select>
                <p className="mt-1 text-xs text-muted">Leave unselected to accept any type.</p>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
                <input id="visaSponsorshipRequired" type="checkbox" checked={form.visaSponsorshipRequired ?? false} onChange={(e) => setField('visaSponsorshipRequired', e.target.checked)} />
                <label htmlFor="visaSponsorshipRequired" className="text-sm text-ink">I require visa sponsorship</label>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
                <input id="remoteOnly" type="checkbox" checked={form.remoteOnly} onChange={(e) => setField('remoteOnly', e.target.checked)} />
                <label htmlFor="remoteOnly" className="text-sm text-ink">Only rank remote-friendly roles highly</label>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card-pad" aria-labelledby="skills-workspace-heading">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-sunken text-accent-text">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="skills-workspace-heading" className="text-base font-semibold text-ink">
              Skills workspace
            </h2>
            <p className="muted mt-1 mb-4">
              Skills discovered while analysing jobs are kept separate from your general skills until you refine and promote
              them. Use AI to merge duplicates, normalise wording and add the ones that belong in your profile.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/career-profile" className="btn-primary text-xs">
                Refine skills with AI
              </Link>
              <Link href="/jobs" className="btn-secondary text-xs">
                Review job intelligence
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void handleSave()}>Save preferences</button>
        {saved ? <span className="text-sm text-success-text">Preferences saved. Job scoring will use these settings immediately.</span> : null}
      </div>
    </div>
  );
}
