'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const items = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#public-jobs', label: 'Public Jobs' },
  { href: '#faq', label: 'FAQ' },
];

export function QuickJumpNav() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onScroll() {
      setShow(window.scrollY > 560);
    }

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!show) return null;

  return (
    <>
      {/* Desktop: vertical pill stack, bottom-right */}
      <div className="fixed bottom-5 right-5 z-30 hidden md:block">
        <div className="rounded-2xl border border-line bg-background/85 p-2 shadow-soft backdrop-blur">
          <div className="flex flex-col gap-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-surface-sunken hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: horizontal scrollable strip, bottom-center. The safe-area
          offset keeps it above the home indicator without adding dead space to
          the footer itself. */}
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-30 flex max-w-full justify-center px-4 md:hidden">
        <div className="flex max-w-full gap-2 overflow-x-auto overscroll-x-contain rounded-2xl border border-line bg-background/90 px-3 py-2 shadow-soft backdrop-blur no-scrollbar">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-xl px-3 py-1.5 text-sm text-muted transition hover:bg-surface-sunken hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
