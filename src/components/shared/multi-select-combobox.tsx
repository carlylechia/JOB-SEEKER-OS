'use client';

import { useMemo, useState } from 'react';

type Props = {
  label: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
  onCreateOption?: (value: string) => Promise<string> | string;
  placeholder?: string;
  limit?: number;
};

function normalize(value: string) {
  return value.toLowerCase().trim();
}

export function MultiSelectCombobox({
  label,
  values,
  options,
  onChange,
  onCreateOption,
  placeholder,
  limit = 8,
}: Props) {
  const [input, setInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const dataListId = useMemo(() => `list-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [label]);

  const filtered = useMemo(() => {
    const query = normalize(input);
    return options
      .filter((option) => !values.includes(option))
      .filter((option) => !query || normalize(option).includes(query))
      .slice(0, 10);
  }, [input, options, values]);

  const exactMatch = options.some((option) => normalize(option) === normalize(input));

  function addValue(value: string) {
    const clean = value.trim();
    if (!clean || values.includes(clean) || values.length >= limit) return;
    onChange([...values, clean]);
    setInput('');
  }

  async function handleAddOrCreate() {
    const clean = input.trim();
    if (!clean || values.length >= limit) return;
    if (exactMatch) {
      addValue(options.find((option) => normalize(option) === normalize(clean)) || clean);
      return;
    }
    if (!onCreateOption) {
      addValue(clean);
      return;
    }
    setIsCreating(true);
    try {
      const created = await onCreateOption(clean);
      addValue(created);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div>
      <label className="mb-2 block text-sm text-muted">{label}</label>
      <div className="rounded-2xl border border-line bg-white/5 p-3">
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-ink"
            >
              {value} <span className="ml-2 text-muted">×</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            list={dataListId}
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAddOrCreate();
              }
            }}
            placeholder={placeholder ?? 'Select or add an option'}
          />
          <button type="button" className="btn-secondary shrink-0" onClick={() => void handleAddOrCreate()} disabled={!input.trim() || isCreating || values.length >= limit}>
            {exactMatch ? 'Add' : isCreating ? 'Adding...' : 'Create'}
          </button>
        </div>
        <datalist id={dataListId}>
          {filtered.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <p className="mt-2 text-xs text-muted">Up to {limit} selections. Typing filters options; if nothing matches, you can create a new one.</p>
      </div>
    </div>
  );
}
