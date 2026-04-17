'use client';

import Link from 'next/link';
import { Home } from 'lucide-react';

export function BackToSiteButton() {
  return (
    <Link
      href="/"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl border border-white/10 bg-[#09111f]/90 px-4 py-2.5 text-sm font-medium text-muted shadow-lg backdrop-blur transition-all hover:border-white/20 hover:text-ink"
    >
      <Home className="h-4 w-4 shrink-0" />
      <span>Back to site</span>
    </Link>
  );
}
