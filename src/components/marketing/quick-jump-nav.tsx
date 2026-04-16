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
        <div className="rounded-2xl border border-white/10 bg-[#08111f]/85 p-2 shadow-soft backdrop-blur">
          <div className="flex flex-col gap-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: horizontal scrollable strip, bottom-center */}
      <div className="fixed bottom-4 left-0 right-0 z-30 flex justify-center px-4 md:hidden">
        <div className="flex max-w-full gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-[#08111f]/90 px-3 py-2 shadow-soft backdrop-blur scrollbar-none">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-xl px-3 py-1.5 text-sm text-muted transition hover:bg-white/5 hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
