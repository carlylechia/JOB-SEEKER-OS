'use client';

/**
 * Form primitives for the resume editor.
 *
 * These exist because the editor needs four things the shared `.input` class
 * does not give it: a visible label tied to the control, an error message that
 * is announced, a stable id for focus management when entries reorder, and a
 * consistent remove affordance.
 *
 * All of them use the application's existing CSS component classes
 * (`.input`, `.btn-secondary`, `.card-pad`) rather than introducing a second
 * visual language. There is no second component library in this project.
 */

import { useId, type ReactNode } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  type = 'text',
  maxLength,
  autoComplete,
  inputMode,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  type?: string;
  maxLength?: number;
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'tel' | 'url';
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        type={type}
        className="input min-w-0 max-w-full disabled:cursor-not-allowed disabled:opacity-60"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  rows = 4,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  rows?: number;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <textarea
        id={id}
        className="input min-w-0 max-w-full resize-y"
        rows={rows}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select
        id={id}
        className="select min-w-0 truncate"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#D4AF37]"
        checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm text-ink">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * An editable list of short strings — technologies, skills, results.
 *
 * Comma-separated on input because that is how people already think about a
 * skills list, and it avoids a tag-input widget for what is fundamentally a
 * short ordered list. Enter commits and starts a new line.
 */
export function ListField({
  label,
  values,
  onChange,
  placeholder,
  hint,
  maxItems = 40,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
  maxItems?: number;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <textarea
        id={id}
        className="input min-w-0 max-w-full resize-y font-mono text-xs"
        rows={Math.min(8, Math.max(2, values.length + 1))}
        value={values.join('\n')}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, maxItems);
          onChange(next);
        }}
      />
    </Field>
  );
}

/**
 * An entry card with reorder and remove controls.
 *
 * Reordering uses explicit up/down buttons rather than drag-and-drop. Drag is
 * pleasant with a mouse and unusable with a keyboard, and "move this role up one"
 * is the operation people actually want; two buttons make it possible for
 * everyone and announce correctly to a screen reader.
 */
export function EntryCard({
  title,
  subtitle,
  onMoveUp,
  onMoveDown,
  onRemove,
  removeLabel,
  canMoveUp,
  canMoveDown,
  children,
}: {
  title: string;
  subtitle?: string | null;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  removeLabel: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  children: ReactNode;
}) {
  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <GripVertical aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{title}</p>
            {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={`Move ${title} up`} onClick={onMoveUp} disabled={!canMoveUp}>
            ↑
          </IconButton>
          <IconButton label={`Move ${title} down`} onClick={onMoveDown} disabled={!canMoveDown}>
            ↓
          </IconButton>
          <IconButton label={removeLabel} onClick={onRemove} tone="danger">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {children}
    </li>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  tone = 'default',
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border border-line text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === 'danger'
          ? 'text-danger-text hover:bg-danger/10'
          : 'text-ink-2 hover:bg-surface-hover'
      }`}
    >
      {children}
    </button>
  );
}

export function AddEntryButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn-secondary w-full">
      <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Shared list-mutation helpers, so every section reorders identically. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const bounded = Math.max(0, Math.min(items.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(bounded, 0, item);
  return next;
}
