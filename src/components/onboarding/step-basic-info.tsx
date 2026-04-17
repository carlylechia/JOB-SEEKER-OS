'use client';

import { Linkedin } from 'lucide-react';

type Props = {
  name: string;
  email: string;
  isLinkedinUser: boolean;
  onNameChange: (v: string) => void;
};

export function StepBasicInfo({ name, email, isLinkedinUser, onNameChange }: Props) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mb-3 text-5xl">👋</div>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Welcome to Job Seeker OS</h2>
        <p className="mt-2 text-sm text-muted">
          Let&apos;s set up your profile so we can personalise your job search experience.
        </p>
      </div>

      {isLinkedinUser && (
        <div className="flex items-center gap-2 rounded-xl border border-[#0077b5]/40 bg-[#0077b5]/10 px-4 py-3">
          <Linkedin size={16} className="shrink-0 text-[#0077b5]" />
          <p className="text-xs text-[#7ec8e3]">
            Signed in with LinkedIn — your name and email are pre-filled.
          </p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Full name</label>
          <input
            className="input"
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Alex Johnson"
            autoComplete="name"
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Email</label>
          <input
            className="input cursor-not-allowed opacity-60"
            type="email"
            value={email}
            readOnly
            tabIndex={-1}
          />
          <p className="mt-1 text-xs text-muted">Your email is set by your account and can&apos;t be changed here.</p>
        </div>
      </div>
    </div>
  );
}
