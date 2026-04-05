'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const links = [
  { href: '#top', label: 'Top' },
  { href: '#features', label: 'Features' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#faq', label: 'FAQ' },
];

export function QuickJumpNav() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 420);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-30 hidden rounded-2xl border border-white/10 bg-[#08111f]/85 p-2 shadow-soft backdrop-blur md:grid">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="rounded-xl px-3 py-2 text-xs text-muted transition hover:bg-white/5 hover:text-ink">
          {link.label}
        </Link>
      ))}
    </div>
  );
}
