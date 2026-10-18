'use client';

/**
 * Template, accent and density controls.
 *
 * Every option here is presentation only. Choosing a template never changes what
 * the document says, never touches the stored content, and never costs anything:
 * switching template re-renders the preview from the same structured content, so
 * "try a different look" cannot damage the user's work.
 *
 * Changing a setting previews immediately and persists on the next Save. That
 * ordering is deliberate — instant feedback matters when the whole point is
 * comparing looks, and an unsaved preference is not data anyone can lose.
 */

import { ATS_STATEMENT } from '@/lib/resume-builder/templates';
import { RESUME_SECTION_KEYS, SECTION_LABELS, type ResumeSectionKey } from '@/lib/resume-builder/schema';

export type TemplateOption = {
  key: string;
  label: string;
  description: string;
  atsPrinciples: boolean;
};

export type AccentOption = {
  key: string;
  accent: string;
  accentDeep: string;
  textOnAccent: string;
};

export function TemplatePicker({
  templates,
  accents,
  densities,
  templateKey,
  accentKey,
  density,
  hiddenSections,
  onTemplateChange,
  onAccentChange,
  onDensityChange,
  onHiddenSectionsChange,
}: {
  templates: TemplateOption[];
  accents: AccentOption[];
  densities: Record<string, string>;
  templateKey: string;
  accentKey: string;
  density: number;
  hiddenSections: string[];
  onTemplateChange: (key: string) => void;
  onAccentChange: (key: string) => void;
  onDensityChange: (value: number) => void;
  onHiddenSectionsChange: (sections: string[]) => void;
}) {
  const active = templates.find((template) => template.key === templateKey);

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Template</legend>
        <div className="space-y-2" role="radiogroup" aria-label="Resume template">
          {templates.map((template) => {
            const selected = template.key === templateKey;
            return (
              <label
                key={template.key}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                  selected ? 'border-accent bg-accent/5' : 'border-line bg-surface hover:bg-surface-hover'
                }`}
              >
                <input
                  type="radio"
                  name="resume-template"
                  className="mt-1 h-4 w-4 shrink-0 accent-[#D4AF37]"
                  checked={selected}
                  onChange={() => onTemplateChange(template.key)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{template.label}</span>
                  <span className="block text-xs text-muted">{template.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        {active?.atsPrinciples ? (
          <p className="mt-2 rounded-lg bg-surface-sunken p-3 text-xs text-ink-2">{ATS_STATEMENT}</p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Accent</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
          {accents.map((accent) => {
            const selected = accent.key === accentKey;
            return (
              <label
                key={accent.key}
                className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs capitalize transition-colors ${
                  selected ? 'border-accent bg-accent/10 font-medium text-ink' : 'border-line bg-surface text-ink-2'
                }`}
              >
                <input
                  type="radio"
                  name="resume-accent"
                  className="sr-only"
                  checked={selected}
                  onChange={() => onAccentChange(accent.key)}
                />
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-3.5 rounded-full border border-line"
                  style={{ background: accent.accent }}
                />
                {accent.key}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Spacing</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Spacing density">
          {[0, 1, 2].map((value) => {
            const selected = value === density;
            return (
              <label
                key={value}
                className={`cursor-pointer rounded-xl border px-3 py-1.5 text-xs transition-colors ${
                  selected ? 'border-accent bg-accent/10 font-medium text-ink' : 'border-line bg-surface text-ink-2'
                }`}
              >
                <input
                  type="radio"
                  name="resume-density"
                  className="sr-only"
                  checked={selected}
                  onChange={() => onDensityChange(value)}
                />
                {densities[String(value)] ?? 'Comfortable'}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          A long resume is never shrunk to fit one page. If it runs to two, it runs to two.
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Hide a section</legend>
        <p className="mb-2 text-xs text-muted">
          Hiding keeps the content. Nothing is deleted, and it comes back the moment you untick it.
        </p>
        <div className="flex flex-wrap gap-2">
          {RESUME_SECTION_KEYS.map((section) => {
            const hidden = hiddenSections.includes(section);
            return (
              <label
                key={section}
                className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  hidden ? 'border-line-strong bg-surface-sunken text-muted line-through' : 'border-line bg-surface text-ink-2'
                }`}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[#D4AF37]"
                  checked={!hidden}
                  onChange={() => {
                    const next = hidden
                      ? hiddenSections.filter((key) => key !== section)
                      : [...hiddenSections, section];
                    onHiddenSectionsChange(next as ResumeSectionKey[]);
                  }}
                />
                {SECTION_LABELS[section]}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}