'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

export function LandingMobileMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-sunken text-ink transition hover:bg-surface-sunken-hover"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open ? (
        <div className="absolute right-0 top-14 z-30 max-h-[calc(100dvh-6rem)] w-[min(88vw,22rem)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card p-3 shadow-soft">
          <div className="grid gap-2">
            <Link
              href="#features"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
            >
              Features
            </Link>

            <Link
              href="#workflow"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
            >
              Workflow
            </Link>

            <Link
              href="#public-jobs"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
            >
              Public Jobs
            </Link>

            <Link
              href="#faq"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
            >
              FAQ
            </Link>

            <div className="my-1 h-px bg-surface-sunken" />

            <Link
              href="/jobs-public"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
            >
              Public Jobs Page
            </Link>

            <Link
              href="/demo"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
            >
              Live Demo
            </Link>

            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
            >
              Sign In
            </Link>

            <Link
              href="/register"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-accent to-accent-hover px-4 py-3 text-sm font-medium text-accent-ink shadow-soft transition hover:opacity-95"
            >
              Create Account
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
