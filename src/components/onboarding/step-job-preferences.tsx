'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { SeniorityLevel } from '@/types';

type Props = {
  jobTitles: string[];
  skills: string[];
  salaryMin: number;
  salaryTarget: number;
  currentLevel: SeniorityLevel;
  targetLevel: SeniorityLevel;
  titleOptions: string[];
  onJobTitlesChange: (v: string[]) => void;
  onSkillsChange: (v: string[]) => void;
  onSalaryMinChange: (v: number) => void;
  onSalaryTargetChange: (v: number) => void;
  onCurrentLevelChange: (v: SeniorityLevel) => void;
  onTargetLevelChange: (v: SeniorityLevel) => void;
};

const SENIORITY_OPTIONS: SeniorityLevel[] = ['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE'];
const QUICK_TITLE_SUGGESTIONS = [
  'Software Engineer',
  'Product Manager',
  'Data Analyst',
  'Customer Success Manager',
];

export function StepJobPreferences({
  jobTitles,
  skills,
  salaryMin,
  salaryTarget,
  currentLevel,
  targetLevel,
  titleOptions,
  onJobTitlesChange,
  onSkillsChange,
  onSalaryMinChange,
  onSalaryTargetChange,
  onCurrentLevelChange,
  onTargetLevelChange,
}: Props) {
  const [titleInput, setTitleInput] = useState('');
  const [skillInput, setSkillInput] = useState('');

  // Filtered title suggestions
  const titleSuggestions = titleInput
    ? titleOptions
        .filter((t) =>
          t.toLowerCase().includes(titleInput.toLowerCase()) &&
          !jobTitles.some((selected) => selected.toLowerCase() === t.toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const readyPercent = Math.min(100, Math.min(jobTitles.length, 3) * 22 + Math.min(skills.length, 5) * 7);

  function addTitle(title: string) {
    const clean = title.trim();
    if (clean && !jobTitles.some((selected) => selected.toLowerCase() === clean.toLowerCase()) && jobTitles.length < 10) {
      onJobTitlesChange([...jobTitles, clean]);
    }
    setTitleInput('');
  }

  function removeTitle(title: string) {
    onJobTitlesChange(jobTitles.filter((t) => t !== title));
  }

  function addSkill(skill: string) {
    const clean = skill.trim();
    if (clean && !skills.some((selected) => selected.toLowerCase() === clean.toLowerCase()) && skills.length < 20) {
      onSkillsChange([...skills, clean]);
    }
    setSkillInput('');
  }

  function removeSkill(skill: string) {
    onSkillsChange(skills.filter((s) => s !== skill));
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mb-3 text-5xl">🎯</div>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Job preferences</h2>
        <p className="mt-2 text-sm text-muted">
          Tell us what you want next. We use these details to rank fresh opportunities against your role, skills and work preferences.
        </p>
      </div>

      {/* Job titles */}
      <div>
        <label htmlFor="onboarding-target-title" className="mb-1.5 block text-sm font-medium text-ink">
          What roles are you targeting?
        </label>
        <p className="mb-3 text-xs text-muted">
          Add a few related titles to broaden your daily matches. You can change these any time.
        </p>
        {/* Selected chips */}
        {jobTitles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {jobTitles.map((title) => (
              <span
                key={title}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-xs font-medium text-accent-text"
              >
                {title}
                <button
                  type="button"
                  onClick={() => removeTitle(title)}
                  aria-label={`Remove ${title}`}
                  className="hover:text-ink"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        {/* Input + suggestions */}
        <div className="relative">
          <input
            id="onboarding-target-title"
            className="input"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTitle(titleInput);
              }
            }}
            placeholder="Search or type a job title…"
          />
          {titleSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-surface-sunken shadow-lg">
              {titleSuggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addTitle(t)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-sunken"
                >
                  <Plus size={13} className="text-muted" aria-hidden="true" />
                  {t}
                </button>
              ))}
              {titleInput && !titleOptions.some((t) => t.toLowerCase() === titleInput.toLowerCase()) && (
                <button
                  type="button"
                  onClick={() => addTitle(titleInput)}
                  className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-sm text-accent-text hover:bg-surface-sunken"
                >
                  <Plus size={13} aria-hidden="true" />
                  Create &ldquo;{titleInput}&rdquo;
                </button>
              )}
            </div>
          )}
        </div>
        {jobTitles.length === 0 ? (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-ink-2">Popular starting points</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_TITLE_SUGGESTIONS.map((title) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => addTitle(title)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent/50 hover:bg-accent/5 hover:text-ink"
                >
                  <Plus className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {title}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-4 rounded-xl border border-line bg-surface p-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-ink">
              {jobTitles.length > 0 ? 'Your match profile is taking shape' : 'Add a role to start personalising matches'}
            </span>
            <span className="shrink-0 text-muted">{jobTitles.length} roles · {skills.length} skills</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
            role="progressbar"
            aria-label="Job match profile setup"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={readyPercent}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${readyPercent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            A few roles and skills help the free daily finder return a broader, more relevant shortlist. Salary is optional.
          </p>
        </div>
      </div>

      {/* Seniority */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Current level</label>
          <div className="flex gap-2 flex-wrap">
            {SENIORITY_OPTIONS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => onCurrentLevelChange(lvl)}
                className={[
                  'rounded-xl border px-3 py-1.5 text-xs font-medium transition-all',
                  currentLevel === lvl
                    ? 'border-accent bg-accent/15 text-accent-text'
                    : 'border-line bg-surface-sunken text-muted hover:border-line hover:bg-surface-sunken-hover',
                ].join(' ')}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Target level</label>
          <div className="flex gap-2 flex-wrap">
            {SENIORITY_OPTIONS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => onTargetLevelChange(lvl)}
                className={[
                  'rounded-xl border px-3 py-1.5 text-xs font-medium transition-all',
                  targetLevel === lvl
                    ? 'border-accent bg-accent/15 text-accent-text'
                    : 'border-line bg-surface-sunken text-muted hover:border-line hover:bg-surface-sunken-hover',
                ].join(' ')}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Skills */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">
          Key skills
          {skills.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted">({skills.length} added)</span>
          )}
        </label>
        {skills.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-3 py-1 text-xs text-ink"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  aria-label={`Remove ${skill}`}
                  className="text-muted hover:text-ink"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSkill(skillInput);
              }
            }}
            placeholder="e.g. TypeScript, React, PostgreSQL…"
          />
          <button
            type="button"
            onClick={() => addSkill(skillInput)}
            disabled={!skillInput.trim()}
            className="btn-secondary shrink-0"
          >
            Add
          </button>
        </div>
      </div>

      {/* Salary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Minimum salary (USD/yr)</label>
          <input
            className="input"
            type="number"
            min={0}
            step={5000}
            value={salaryMin || ''}
            onChange={(e) => onSalaryMinChange(Number(e.target.value))}
            placeholder="e.g. 80000"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Target salary (USD/yr)</label>
          <input
            className="input"
            type="number"
            min={0}
            step={5000}
            value={salaryTarget || ''}
            onChange={(e) => onSalaryTargetChange(Number(e.target.value))}
            placeholder="e.g. 120000"
          />
        </div>
      </div>
    </div>
  );
}
