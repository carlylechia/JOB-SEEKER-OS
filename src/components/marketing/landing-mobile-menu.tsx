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
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-black/[0.03] text-ink transition hover:bg-black/[0.06]"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open ? (
        <div className="absolute right-0 top-14 z-30 w-[min(88vw,22rem)] rounded-2xl border border-line bg-[#FFFFFF]/95 p-3 shadow-soft backdrop-blur">
          <div className="grid gap-2">
            <Link
              href="#features"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-black/[0.03] px-4 py-3 text-sm text-ink transition hover:bg-black/[0.06]"
            >
              Features
            </Link>

            <Link
              href="#workflow"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-black/[0.03] px-4 py-3 text-sm text-ink transition hover:bg-black/[0.06]"
            >
              Workflow
            </Link>

            <Link
              href="#public-jobs"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-black/[0.03] px-4 py-3 text-sm text-ink transition hover:bg-black/[0.06]"
            >
              Public Jobs
            </Link>

            <Link
              href="#faq"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-black/[0.03] px-4 py-3 text-sm text-ink transition hover:bg-black/[0.06]"
            >
              FAQ
            </Link>

            <div className="my-1 h-px bg-black/[0.05]" />

            <Link
              href="/jobs-public"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-black/[0.03] px-4 py-3 text-sm text-ink transition hover:bg-black/[0.06]"
            >
              Public Jobs Page
            </Link>

            <Link
              href="/demo"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-black/[0.03] px-4 py-3 text-sm text-ink transition hover:bg-black/[0.06]"
            >
              Live Demo
            </Link>

            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-black/[0.03] px-4 py-3 text-sm text-ink transition hover:bg-black/[0.06]"
            >
              Sign In
            </Link>

            <Link
              href="/register"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B8962E] px-4 py-3 text-sm font-medium text-[#17191E] shadow-soft transition hover:opacity-95"
            >
              Create Account
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
