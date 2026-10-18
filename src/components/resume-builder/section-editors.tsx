'use client';

/**
 * Section editors.
 *
 * One component per resume section, each taking the whole section array and a
 * single `onChange` that replaces it. They never mutate the document in place
 * and they never touch anything outside their own section, which is what makes
 * them independently testable and safe to render one at a time as the user
 * navigates.
 *
 * Entries keep a stable client-generated `id` so React does not remount a form
 * when the user reorders the list — losing focus mid-edit is the single most
 * annoying bug in an editor like this one.
 */

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import {
  RESUME_MAX_BULLETS,
  RESUME_MAX_CREDENTIALS,
  RESUME_MAX_EDUCATION,
  RESUME_MAX_EXPERIENCES,
  RESUME_MAX_PROJECTS,
  RESUME_MAX_SKILLS,
  type ResumeContent,
  type ResumeCredential,
  type ResumeEducation,
  type ResumeExperience,
  type ResumeProject,
  type ResumeSkill,
} from '@/lib/resume-builder/schema';
import { normalizeResumeDate } from '@/lib/resume-builder/schema';
import {
  AddEntryButton,
  CheckboxField,
  EntryCard,
  ListField,
  SelectField,
  TextAreaField,
  TextField,
  moveItem,
} from './fields';

/** Ids are generated here, never by the server, and never from user input. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `e${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

function formatMonth(date: string | null): string {
  const normalised = normalizeResumeDate(date);
  if (!normalised) return '';
  const [year, month] = normalised.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(month) - 1] ?? month} ${year}`;
}

// ─── Basics ─────────────────────────────────────────────────────────────────

export function BasicsEditor({
  basics,
  onChange,
}: {
  basics: ResumeContent['basics'];
  onChange: (next: ResumeContent['basics']) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Full name" value={basics.fullName ?? ''} autoComplete="name" onChange={(v) => onChange({ ...basics, fullName: v })} />
      <TextField
        label="Professional headline"
        value={basics.headline ?? ''}
        maxLength={400}
        hint="One line: your role and what you are known for."
        onChange={(v) => onChange({ ...basics, headline: v })}
      />
      <TextField label="Email" type="email" inputMode="email" autoComplete="email" value={basics.email ?? ''} onChange={(v) => onChange({ ...basics, email: v })} />
      <TextField label="Phone" type="tel" inputMode="tel" autoComplete="tel" value={basics.phone ?? ''} onChange={(v) => onChange({ ...basics, phone: v })} />
      <TextField label="Location" value={basics.location ?? ''} placeholder="City, Country" onChange={(v) => onChange({ ...basics, location: v })} />
      <TextField label="LinkedIn" inputMode="url" value={basics.linkedinUrl ?? ''} placeholder="linkedin.com/in/you" onChange={(v) => onChange({ ...basics, linkedinUrl: v })} />
      <TextField label="Portfolio" inputMode="url" value={basics.portfolioUrl ?? ''} placeholder="yourwork.dev" onChange={(v) => onChange({ ...basics, portfolioUrl: v })} />
      <TextField label="Website" inputMode="url" value={basics.websiteUrl ?? ''} onChange={(v) => onChange({ ...basics, websiteUrl: v })} />
      <p className="muted sm:col-span-2">
        Only http and https links are kept. Anything else is refused, because these values end up in a
        document someone else opens.
      </p>
    </div>
  );
}

export function SummaryEditor({
  summary,
  onChange,
}: {
  summary: string | null;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-3">
      <TextAreaField
        label="Professional summary"
        value={summary ?? ''}
        rows={5}
        maxLength={2000}
        hint="Two or four sentences on what you do and what you are good at. Written by you or suggested by AI — you decide."
        onChange={onChange}
      />
    </div>
  );
}

// ─── Experience ─────────────────────────────────────────────────────────────

export function ExperienceEditor({
  entries,
  onChange,
}: {
  entries: ResumeExperience[];
  onChange: (next: ResumeExperience[]) => void;
}) {
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  const update = (id: string, patch: Partial<ResumeExperience>) =>
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <p className="muted">
          No roles yet. Add the ones you want on this resume — you do not need to add every job you
          have ever had.
        </p>
      ) : null}

      <ul className="space-y-4">
        {entries.map((entry, index) => {
          const title = entry.jobTitle || entry.company || `Role ${index + 1}`;
          const dates = [formatMonth(entry.startDate), entry.isCurrent ? 'Present' : formatMonth(entry.endDate)]
            .filter(Boolean)
            .join(' – ');
          return (
            <EntryCard
              key={entry.id}
              title={title}
              subtitle={[entry.company, dates].filter(Boolean).join(' · ') || null}
              canMoveUp={index > 0}
              canMoveDown={index < entries.length - 1}
              onMoveUp={() => onChange(moveItem(entries, index, index - 1))}
              onMoveDown={() => onChange(moveItem(entries, index, index + 1))}
              removeLabel={`Remove ${title}`}
              onRemove={() =>
                pendingRemoval === entry.id
                  ? (onChange(entries.filter((candidate) => candidate.id !== entry.id)),
                    setPendingRemoval(null))
                  : setPendingRemoval(entry.id)
              }
            >
              {pendingRemoval === entry.id ? (
                <div
                  role="alertdialog"
                  aria-label={`Confirm removing ${title}`}
                  className="mb-3 rounded-lg border border-danger/40 bg-danger/5 p-3"
                >
                  <p className="text-sm text-ink">
                    Remove <strong>{title}</strong> from this resume? This only affects this resume.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPendingRemoval(null)}
                    >
                      Keep it
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: 'rgb(var(--danger))', color: '#fff' }}
                      onClick={() => {
                        onChange(entries.filter((candidate) => candidate.id !== entry.id));
                        setPendingRemoval(null);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Job title" value={entry.jobTitle ?? ''} onChange={(v) => update(entry.id, { jobTitle: v })} />
                <TextField label="Company" value={entry.company ?? ''} onChange={(v) => update(entry.id, { company: v })} />
                <TextField label="Location" value={entry.location ?? ''} onChange={(v) => update(entry.id, { location: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="Start"
                    value={entry.startDate ?? ''}
                    placeholder="2021-03"
                    hint="Month and year"
                    onChange={(v) => update(entry.id, { startDate: v })}
                  />
                  <TextField
                    label="End"
                    value={entry.isCurrent ? '' : (entry.endDate ?? '')}
                    placeholder="2024-06"
                    disabled={entry.isCurrent}
                    onChange={(v) => update(entry.id, { endDate: v })}
                  />
                </div>
              </div>

              <div className="mt-4">
                <CheckboxField
                  label="I currently work here"
                  checked={entry.isCurrent}
                  hint="The end date is ignored while this is ticked."
                  onChange={(checked) =>
                    update(entry.id, { isCurrent: checked, endDate: checked ? null : entry.endDate })
                  }
                />
              </div>

              <div className="mt-4 space-y-4">
                <ListField
                  label="Responsibilities"
                  values={entry.responsibilities}
                  maxItems={RESUME_MAX_BULLETS}
                  placeholder={'What the role involved\nWhat you owned day to day'}
                  onChange={(values) => update(entry.id, { responsibilities: values })}
                />
                <ListField
                  label="Achievements"
                  values={entry.achievements}
                  maxItems={RESUME_MAX_BULLETS}
                  placeholder="What changed because you were there. Only include results you can stand behind."
                  onChange={(values) => update(entry.id, { achievements: values })}
                />
                <ListField
                  label="Technologies"
                  values={entry.technologies}
                  placeholder={'Go\nPostgreSQL'}
                  onChange={(values) => update(entry.id, { technologies: values })}
                />
              </div>

              {entry.origin === 'CAREER_PROFILE' ? (
                <p className="mt-3 text-xs text-muted">
                  Imported from your career profile. Editing this resume does not change your profile.
                </p>
              ) : null}
            </EntryCard>
          );
        })}
      </ul>

      <AddEntryButton
        label="Add a role"
        disabled={entries.length >= RESUME_MAX_EXPERIENCES}
        onClick={() =>
          onChange([
            ...entries,
            {
              id: newId(),
              jobTitle: null,
              company: null,
              location: null,
              startDate: null,
              endDate: null,
              isCurrent: false,
              responsibilities: [],
              achievements: [],
              technologies: [],
              origin: 'USER',
              evidenceSnippet: null,
            },
          ])
        }
      />
      {entries.length >= RESUME_MAX_EXPERIENCES ? (
        <p className="text-xs text-muted">This resume has reached the maximum of {RESUME_MAX_EXPERIENCES} roles.</p>
      ) : null}
    </div>
  );
}

// ─── Education ──────────────────────────────────────────────────────────────

export function EducationEditor({
  entries,
  onChange,
}: {
  entries: ResumeEducation[];
  onChange: (next: ResumeEducation[]) => void;
}) {
  const update = (id: string, patch: Partial<ResumeEducation>) =>
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  return (
    <div className="space-y-4">
      {entries.length === 0 ? <p className="muted">Nothing here yet.</p> : null}
      <ul className="space-y-4">
        {entries.map((entry, index) => (
          <EntryCard
            key={entry.id}
            title={entry.qualification || entry.institution || `Education ${index + 1}`}
            subtitle={entry.institution ?? null}
            canMoveUp={index > 0}
            canMoveDown={index < entries.length - 1}
            onMoveUp={() => onChange(moveItem(entries, index, index - 1))}
            onMoveDown={() => onChange(moveItem(entries, index, index + 1))}
            removeLabel={`Remove ${entry.qualification || entry.institution || `education ${index + 1}`}`}
            onRemove={() => onChange(entries.filter((candidate) => candidate.id !== entry.id))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Qualification" value={entry.qualification ?? ''} onChange={(v) => update(entry.id, { qualification: v })} />
              <TextField label="Institution" value={entry.institution ?? ''} onChange={(v) => update(entry.id, { institution: v })} />
              <TextField label="Field of study" value={entry.fieldOfStudy ?? ''} onChange={(v) => update(entry.id, { fieldOfStudy: v })} />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Start" value={entry.startDate ?? ''} placeholder="2012-10" onChange={(v) => update(entry.id, { startDate: v })} />
                <TextField label="End" value={entry.endDate ?? ''} placeholder="2014-09" onChange={(v) => update(entry.id, { endDate: v })} />
              </div>
            </div>
            <div className="mt-4">
              <TextAreaField
                label="Details"
                rows={3}
                value={entry.details ?? ''}
                hint="Grade, thesis, honours — only if you want it on the page."
                onChange={(v) => update(entry.id, { details: v })}
              />
            </div>
          </EntryCard>
        ))}
      </ul>
      <AddEntryButton
        label="Add education"
        disabled={entries.length >= RESUME_MAX_EDUCATION}
        onClick={() =>
          onChange([
            ...entries,
            {
              id: newId(),
              institution: null,
              qualification: null,
              fieldOfStudy: null,
              startDate: null,
              endDate: null,
              details: null,
              origin: 'USER',
            },
          ])
        }
      />
    </div>
  );
}

// ─── Skills ─────────────────────────────────────────────────────────────────

const SKILL_ORIGIN_HINT: Record<ResumeSkill['origin'], string> = {
  USER: 'You added this.',
  STATED: 'Confirmed in your career profile as something you listed.',
  SUPPORTED: 'Confirmed in your career profile, supported by a role you described.',
  INFERRED: 'Suggested during resume analysis. Not verified — check it before sending this out.',
};

export function SkillsEditor({
  entries,
  onChange,
}: {
  entries: ResumeSkill[];
  onChange: (next: ResumeSkill[]) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = entries.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setName('');
      return;
    }
    onChange([
      ...entries,
      {
        id: newId(),
        name: trimmed,
        category: category.trim() ? category.trim() : null,
        origin: 'USER',
      },
    ]);
    setName('');
  };

  const update = (id: string, patch: Partial<ResumeSkill>) =>
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <TextField label="Add a skill" value={name} placeholder="Type a skill and press Add" onChange={setName} />
        </div>
        <div className="min-w-0 flex-1">
          <TextField
            label="Group (optional)"
            value={category}
            placeholder="Backend, Languages…"
            onChange={setCategory}
          />
        </div>
        <button type="button" className="btn-secondary h-[38px]" onClick={add}>
          Add
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="muted">
          No skills yet. Add the ones you actually use — a short, accurate list beats a long one.
        </p>
      ) : null}

      <ul className="space-y-2">
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{entry.name}</p>
              {entry.origin !== 'USER' ? (
                <p className="text-xs text-muted">{SKILL_ORIGIN_HINT[entry.origin]}</p>
              ) : null}
            </div>
            <div className="w-36">
              <input
                className="input py-1 text-xs"
                value={entry.category ?? ''}
                placeholder="Group"
                aria-label={`Group for ${entry.name}`}
                onChange={(event) => update(entry.id, { category: event.target.value })}
              />
            </div>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-xs text-ink-2 disabled:opacity-40"
              aria-label={`Move ${entry.name} up`}
              disabled={index === 0}
              onClick={() => onChange(moveItem(entries, index, index - 1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-xs text-ink-2 disabled:opacity-40"
              aria-label={`Move ${entry.name} down`}
              disabled={index === entries.length - 1}
              onClick={() => onChange(moveItem(entries, index, index + 1))}
            >
              ↓
            </button>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-xs text-danger-text hover:bg-danger/10"
              aria-label={`Remove ${entry.name}`}
              onClick={() => onChange(entries.filter((candidate) => candidate.id !== entry.id))}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      </div>
  );
}

// ─── Projects ───────────────────────────────────────────────────────────────

export function ProjectsEditor({
  entries,
  onChange,
}: {
  entries: ResumeProject[];
  onChange: (next: ResumeProject[]) => void;
}) {
  const update = (id: string, patch: Partial<ResumeProject>) =>
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  return (
    <div className="space-y-4">
      {entries.length === 0 ? <p className="muted">Nothing here yet.</p> : null}
      <ul className="space-y-4">
        {entries.map((entry, index) => (
          <EntryCard
            key={entry.id}
            title={entry.name || `Project ${index + 1}`}
            subtitle={entry.role ?? null}
            canMoveUp={index > 0}
            canMoveDown={index < entries.length - 1}
            onMoveUp={() => onChange(moveItem(entries, index, index - 1))}
            onMoveDown={() => onChange(moveItem(entries, index, index + 1))}
            removeLabel={`Remove ${entry.name || `project ${index + 1}`}`}
            onRemove={() => onChange(entries.filter((candidate) => candidate.id !== entry.id))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Name" value={entry.name ?? ''} onChange={(v) => update(entry.id, { name: v })} />
              <TextField label="Your role" value={entry.role ?? ''} onChange={(v) => update(entry.id, { role: v })} />
              <TextField label="URL" inputMode="url" value={entry.projectUrl ?? ''} onChange={(v) => update(entry.id, { projectUrl: v })} />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Start" value={entry.startDate ?? ''} placeholder="2022-01" onChange={(v) => update(entry.id, { startDate: v })} />
                <TextField label="End" value={entry.endDate ?? ''} placeholder="2023-01" onChange={(v) => update(entry.id, { endDate: v })} />
              </div>
            </div>
            <div className="mt-4 space-y-4">
              <TextAreaField label="Description" rows={3} value={entry.description ?? ''} onChange={(v) => update(entry.id, { description: v })} />
              <ListField label="Technologies" values={entry.technologies} onChange={(values) => update(entry.id, { technologies: values })} />
              <ListField label="Results" values={entry.results} maxItems={15} onChange={(values) => update(entry.id, { results: values })} />
            </div>
          </EntryCard>
        ))}
      </ul>
      <AddEntryButton
        label="Add a project"
        disabled={entries.length >= RESUME_MAX_PROJECTS}
        onClick={() =>
          onChange([
            ...entries,
            {
              id: newId(),
              name: null,
              description: null,
              role: null,
              technologies: [],
              startDate: null,
              endDate: null,
              projectUrl: null,
              results: [],
              origin: 'USER',
            },
          ])
        }
      />
    </div>
  );
}

// ─── Credentials ────────────────────────────────────────────────────────────

const CREDENTIAL_KINDS: Array<{ value: ResumeCredential['kind']; label: string }> = [
  { value: 'CERTIFICATION', label: 'Certification' },
  { value: 'LICENSE', label: 'Licence' },
  { value: 'LANGUAGE', label: 'Language' },
  { value: 'AWARD', label: 'Award' },
  { value: 'PUBLICATION', label: 'Publication' },
  { value: 'VOLUNTEER', label: 'Volunteer work' },
];

export function CredentialsEditor({
  entries,
  onChange,
}: {
  entries: ResumeCredential[];
  onChange: (next: ResumeCredential[]) => void;
}) {
  const update = (id: string, patch: Partial<ResumeCredential>) =>
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  return (
    <div className="space-y-4">
      {entries.length === 0 ? <p className="muted">Nothing here yet.</p> : null}
      <ul className="space-y-4">
        {entries.map((entry, index) => (
          <EntryCard
            key={entry.id}
            title={entry.name || `Entry ${index + 1}`}
            subtitle={CREDENTIAL_KINDS.find((kind) => kind.value === entry.kind)?.label ?? null}
            canMoveUp={index > 0}
            canMoveDown={index < entries.length - 1}
            onMoveUp={() => onChange(moveItem(entries, index, index - 1))}
            onMoveDown={() => onChange(moveItem(entries, index, index + 1))}
            removeLabel={`Remove ${entry.name || `entry ${index + 1}`}`}
            onRemove={() => onChange(entries.filter((candidate) => candidate.id !== entry.id))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Type"
                value={entry.kind}
                options={CREDENTIAL_KINDS}
                onChange={(kind) => update(entry.id, { kind })}
              />
              <TextField label="Name" value={entry.name} onChange={(v) => update(entry.id, { name: v })} />
              <TextField
                label="Issuer"
                value={entry.issuer ?? ''}
                hint={entry.kind === 'LANGUAGE' ? 'Leave blank for a language.' : 'Who issued it'}
                onChange={(v) => update(entry.id, { issuer: v })}
              />
              <TextField
                label="Proficiency"
                value={entry.proficiency ?? ''}
                placeholder="Fluent, B2…"
                hint="Languages only."
                onChange={(v) => update(entry.id, { proficiency: v })}
              />
              <TextField label="Issued" value={entry.issuedDate ?? ''} placeholder="2023-05" onChange={(v) => update(entry.id, { issuedDate: v })} />
              <TextField label="Expires" value={entry.expiresDate ?? ''} placeholder="2026-05" onChange={(v) => update(entry.id, { expiresDate: v })} />
            </div>
            <div className="mt-4">
              <TextAreaField label="Details" rows={2} value={entry.details ?? ''} onChange={(v) => update(entry.id, { details: v })} />
            </div>
          </EntryCard>
        ))}
      </ul>
      <AddEntryButton
        label="Add a certification, language or award"
        disabled={entries.length >= RESUME_MAX_CREDENTIALS}
        onClick={() =>
          onChange([
            ...entries,
            {
              id: newId(),
              kind: 'CERTIFICATION',
              name: '',
              issuer: null,
              issuedDate: null,
              expiresDate: null,
              proficiency: null,
              details: null,
              origin: 'USER',
            },
          ])
        }
      />
      <p className="text-xs text-muted">
        Credentials are never rewritten by AI. A reworded certification is a different certification.
      </p>
    </div>
  );
}