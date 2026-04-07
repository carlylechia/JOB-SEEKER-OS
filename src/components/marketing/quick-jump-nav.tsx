'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const items = [
  { href: '#features', label: 'Features' },
  { href: '#workflow', label: 'Workflow' },
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
  );
}
