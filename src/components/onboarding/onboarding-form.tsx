'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { defaultPreferences, parseCommaList, stringifyList } from '@/lib/preferences';
import { SeniorityLevel, UserPreferences, WorkRegion } from '@/types';

const seniorityOptions: SeniorityLevel[] = ['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE'];
const regionOptions: WorkRegion[] = ['US', 'EU', 'AFRICA', 'WORLDWIDE', 'FLEXIBLE'];

export function OnboardingForm({
  initialPreferences,
  onboardingCompleted,
}: {
  initialPreferences?: UserPreferences | null;
  onboardingCompleted?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<UserPreferences>(initialPreferences ?? defaultPreferences);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPreferences) setForm(initialPreferences);
  }, [initialPreferences]);

  function setField<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, onboardingCompleted: true }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save onboarding details.');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save onboarding details.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
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
          <input className="input" value={stringifyList(form.targetRoles)} onChange={(e) => setField('targetRoles', parseCommaList(e.target.value))} placeholder="Full-Stack Engineer, Backend Engineer" />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Preferred titles</label>
          <input className="input" value={stringifyList(form.preferredTitles)} onChange={(e) => setField('preferredTitles', parseCommaList(e.target.value))} placeholder="Software Engineer II, Product Engineer" />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Preferred regions</label>
          <input className="input" value={stringifyList(form.preferredRegions)} onChange={(e) => setField('preferredRegions', parseCommaList(e.target.value))} placeholder="Africa, Worldwide, Europe" />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Preferred stack</label>
          <input className="input" value={stringifyList(form.preferredStack)} onChange={(e) => setField('preferredStack', parseCommaList(e.target.value))} placeholder="TypeScript, Next.js, Node.js" />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Must-have tech</label>
          <input className="input" value={stringifyList(form.mustHaveTech)} onChange={(e) => setField('mustHaveTech', parseCommaList(e.target.value))} placeholder="TypeScript, PostgreSQL" />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Preferred work-region overlap</label>
          <select className="select min-h-32" multiple value={form.workRegions} onChange={(e) => setField('workRegions', Array.from(e.target.selectedOptions).map((option) => option.value as WorkRegion))}>
            {regionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <p className="mt-2 text-xs text-muted">Hold Cmd/Ctrl to select multiple regions.</p>
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
          <input id="remoteOnlyOnboarding" type="checkbox" checked={form.remoteOnly} onChange={(e) => setField('remoteOnly', e.target.checked)} />
          <label htmlFor="remoteOnlyOnboarding" className="text-sm text-ink">Prioritize remote-friendly roles</label>
        </div>
      </div>

      <div className="card-pad space-y-3">
        <h3 className="text-lg font-semibold">Why this matters</h3>
        <p className="muted text-sm leading-7">
          These preferences control how the app scores and ranks opportunities. They also shape future features like ingestion,
          fit explanations, and daily best-fit recommendations.
        </p>
        {error ? <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving preferences...' : onboardingCompleted ? 'Update onboarding profile' : 'Save and continue'}
          </button>
          <button className="btn-secondary" type="button" onClick={() => router.push('/dashboard')}>
            Skip for now
          </button>
        </div>
      </div>
    </form>
  );
}
