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
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white/5 text-ink transition hover:bg-white/10"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open ? (
        <div className="absolute right-0 top-14 z-30 w-[min(88vw,22rem)] rounded-2xl border border-line bg-[#09111f]/95 p-3 shadow-soft backdrop-blur">
          <div className="grid gap-2">
            <Link
              href="/demo"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-white/5 px-4 py-3 text-sm text-ink transition hover:bg-white/10"
            >
              Live Demo
            </Link>

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