'use client';

import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { Template } from '@/types';
import { demoTemplates } from '@/lib/demo-data';

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'intro', label: 'Intro' },
  { key: 'follow_up', label: 'Follow-Up' },
  { key: 'thank_you', label: 'Thank You' },
  { key: 'check_in', label: 'Check-In' },
  { key: 'referral', label: 'Referral' },
];

function applyVariables(text: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v || `{{${k}}}`), text);
}

function pickRandom<T>(arr: T[], exclude?: T): T {
  if (arr.length <= 1) return arr[0];
  const pool = exclude !== undefined ? arr.filter((x) => x !== exclude) : arr;
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function TemplatesPage() {
  const { templates: userTemplates, isLoading } = useJobs();
  const [category, setCategory] = useState('all');
  const [current, setCurrent] = useState<Template | null>(null);
  const [copied, setCopied] = useState(false);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');

  // Merge user templates with defaults; user templates take priority
  const allTemplates = useMemo<Template[]>(() => {
    const userIds = new Set(userTemplates.map((t) => t.id));
    const defaults = demoTemplates.filter((t) => !userIds.has(t.id));
    return [...userTemplates, ...defaults];
  }, [userTemplates]);

  const filtered = useMemo(
    () => (category === 'all' ? allTemplates : allTemplates.filter((t) => t.type === category)),
    [allTemplates, category],
  );

  // Pick initial on first render or when category changes
  const displayed: Template | null = current && filtered.includes(current) ? current : (filtered[0] ?? null);

  function handleCategoryChange(key: string) {
    setCategory(key);
    setCurrent(null);
    setCopied(false);
  }

  function handleGenerate() {
    setCurrent(pickRandom(filtered, displayed ?? undefined));
    setCopied(false);
  }

  async function handleCopy() {
    if (!displayed) return;
    const vars: Record<string, string> = { company, role };
    const body = applyVariables(displayed.body, vars);
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) return <div className="card-pad">Loading templates…</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Templates"
        subtitle="Reusable templates for outreach, follow-ups, thank-you notes, and more."
      />

      {/* Personalization inputs */}
      <div className="card-pad">
        <div className="text-sm font-medium text-muted mb-3">Personalize (optional)</div>
        <div className="flex flex-wrap gap-3">
          <input
            className="input max-w-xs"
            placeholder="Company name"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <input
            className="input max-w-xs"
            placeholder="Role / position"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted mt-2">
          These replace <code className="bg-white/10 px-1 rounded">{'{{company}}'}</code> and <code className="bg-white/10 px-1 rounded">{'{{role}}'}</code> placeholders when you copy.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.35fr_0.65fr]">
        {/* Category + list */}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`btn-secondary text-sm py-1 ${category === c.key ? 'border-accent text-white' : ''}`}
                onClick={() => handleCategoryChange(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setCurrent(t); setCopied(false); }}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${displayed?.id === t.id ? 'border-accent bg-accent/10' : 'border-line hover:border-white/20'}`}
              >
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-muted mt-0.5 capitalize">{t.type.replace('_', ' ')}</div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="muted text-sm py-4 text-center">No templates in this category.</div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="card-pad space-y-4">
          {displayed ? (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-lg font-semibold">{displayed.name}</h3>
                  <p className="text-sm text-muted capitalize">{displayed.type.replace('_', ' ')}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" className="btn-secondary text-sm" onClick={handleGenerate}>
                    Generate another
                  </button>
                  <button type="button" className="btn-primary text-sm" onClick={handleCopy}>
                    {copied ? '✓ Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {displayed.subject && (
                <div>
                  <div className="text-xs text-muted uppercase tracking-wide mb-1">Subject</div>
                  <div className="rounded-xl border border-line bg-white/5 p-3 text-sm">
                    {applyVariables(displayed.subject, { company, role })}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs text-muted uppercase tracking-wide mb-1">Body</div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-ink rounded-xl border border-line bg-white/5 p-4 leading-relaxed overflow-auto max-h-96">
                  {applyVariables(displayed.body, { company, role })}
                </pre>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-muted">
              <div className="text-3xl mb-3">📄</div>
              Select a template from the left.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

