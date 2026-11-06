'use client';

import { useState } from 'react';
import { Plus, Check } from 'lucide-react';

type Props = {
  skill: string;
  resumeId?: string;
  label?: string;
};

export function AddSkillButton({ skill, resumeId, label }: Props) {
  const [state, setState] = useState<'idle' | 'saving' | 'added' | 'error'>('idle');
  const clean = skill.trim();

  async function add() {
    if (!clean || state === 'saving' || state === 'added') return;
    setState('saving');
    try {
      const profileRes = await fetch('/api/preferences/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: clean }),
      });
      if (!profileRes.ok) throw new Error('profile');
      if (resumeId) {
        const resumeRes = await fetch(`/api/resumes/${resumeId}/skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skill: clean }),
        });
        if (!resumeRes.ok) throw new Error('resume');
      }
      setState('added');
    } catch {
      setState('error');
    }
  }

  if (state === 'added') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success-text">
        <Check className="h-3 w-3" aria-hidden="true" />
        Added to skills
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void add()}
      disabled={state === 'saving'}
      className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 text-xs font-medium text-accent-text transition hover:bg-accent/10 disabled:opacity-60"
      title="Add this skill to your profile and preferences"
    >
      <Plus className="h-3 w-3" aria-hidden="true" />
      {state === 'saving' ? 'Adding…' : label ?? 'Add to my skills'}
    </button>
  );
}
