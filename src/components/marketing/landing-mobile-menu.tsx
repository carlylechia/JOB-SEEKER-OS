'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Menu, X } from 'lucide-react';

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#public-jobs', label: 'Public Jobs' },
  { href: '#faq', label: 'FAQ' },
];

export function LandingMobileMenu({ isSignedIn = false }: { isSignedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative md:hidden">
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
        <div className="absolute right-0 top-14 z-40 max-h-[calc(100dvh-6rem)] w-[min(88vw,22rem)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card p-3 shadow-lift">
          <div className="grid gap-2">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
              >
                {link.label}
              </a>
            ))}

            <div className="my-1 h-px bg-line" />

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
              Watch demo
            </Link>

            {isSignedIn ? (
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink shadow-[0_10px_32px_rgb(var(--accent)/0.18)] transition hover:bg-accent-hover"
              >
                <LayoutDashboard className="h-4 w-4" />
                Go to Dashboard
              </Link>
            ) : (
              <>
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
                  className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink shadow-[0_10px_32px_rgb(var(--accent)/0.18)] transition hover:bg-accent-hover"
                >
                  Start free
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}