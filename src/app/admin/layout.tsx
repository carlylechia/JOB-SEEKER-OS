import type { ReactNode } from 'react';
import Link from 'next/link';
import { Shield } from 'lucide-react';
import { requireAdmin } from '@/lib/authz';
import { Logo } from '@/components/shared/logo';
import { ThemeSwitch } from '@/components/shared/theme-switch';
import { BackToSiteButton } from '@/components/layout/back-to-site-button';

export const dynamic = 'force-dynamic';

/**
 * Admin layout.
 *
 * Every /admin/* page is protected at the SERVER level here. Individual pages
 * also call `requireAdmin()` — this layout is the outer gate, not the only one.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-line bg-[color:var(--nav-scrim)] backdrop-blur-xl supports-[backdrop-filter]:bg-[color:var(--nav-scrim)]">
        <div className="shell flex min-h-16 items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <Logo compact href="/dashboard" />
            <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-2 sm:inline-flex">
              <Shield className="h-3.5 w-3.5" />
              Admin
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeSwitch size="sm" />
            <Link href="/dashboard" className="btn-secondary">
              Back to app
            </Link>
          </div>
        </div>
      </header>

      <main className="shell py-6 lg:py-8">
        <div className="min-w-0">{children}</div>
      </main>

      <BackToSiteButton />
    </div>
  );
}