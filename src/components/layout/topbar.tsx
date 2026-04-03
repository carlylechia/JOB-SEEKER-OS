import Link from 'next/link';
import { Bell, Search } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { TopbarMobileMenu } from './topbar-mobile-menu';

export function Topbar({ user }: { user: { name?: string | null; email?: string | null } }) {
  const label = user.name || user.email || 'Account';

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur">
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 lg:px-8">
        <div className="flex items-center">
          <div className="lg:hidden">
            <Logo compact href="/dashboard" />
          </div>

          <div className="relative hidden w-full max-w-md md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Search jobs, companies, contacts..." />
          </div>
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <span className="hidden rounded-xl border border-line bg-white/5 px-3 py-2 text-sm text-muted md:inline-flex">
            {label}
          </span>

          <button className="btn-secondary inline-flex items-center justify-center" aria-label="Notifications">
            <Bell className="h-4 w-4" />
          </button>

          <Link href="/jobs/new" className="btn-primary inline-flex items-center justify-center">
            Add Job
          </Link>

          <form action="/api/auth/signout" method="post">
            <button type="submit" className="btn-secondary inline-flex items-center justify-center" aria-label="Sign out">
              Sign out
            </button>
          </form>
        </div>

        <div className="lg:hidden">
          <TopbarMobileMenu label={label} />
        </div>
      </div>
    </header>
  );
}