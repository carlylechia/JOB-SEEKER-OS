'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

const links = [
  { href: '/#features', label: 'Features' },
  { href: '/#workflow', label: 'Workflow' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/demo', label: 'Live Demo' },
  { href: '/jobs-public', label: 'Public Jobs' },
];

export function LandingMobileMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white/5 text-ink transition hover:bg-white/10"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open ? (
        <div className="absolute right-0 top-14 z-30 w-[min(88vw,22rem)] rounded-2xl border border-line bg-[#09111f]/95 p-3 shadow-soft backdrop-blur">
          <div className="mb-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">
            Explore the platform
          </div>
          <div className="grid gap-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-xl border border-line bg-white/5 px-4 py-3 text-sm text-ink transition hover:bg-white/10"
              >
                {link.label}
              </Link>
            ))}

            <div className="my-1 h-px bg-white/10" />

            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-white/5 px-4 py-3 text-sm text-ink transition hover:bg-white/10"
            >
              Sign In
            </Link>

            <Link
              href="/register"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-soft transition hover:opacity-95"
            >
              Create Account
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
