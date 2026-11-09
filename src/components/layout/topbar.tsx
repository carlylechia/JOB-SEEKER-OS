import Link from 'next/link';
import { Search } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { ThemeSwitch } from '@/components/shared/theme-switch';
import { TopbarMobileMenu } from './topbar-mobile-menu';
import { SignOutButton } from './sign-out-button';
import { NotificationBell } from './notification-bell';

type TopbarUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
};

function UserAvatar({ user }: { user: TopbarUser }) {
  const initials = (user.name ?? user.email ?? '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (user.image) {
    return (
      <img
        src={user.image}
        alt={user.name ?? 'Profile'}
        className="h-8 w-8 rounded-full object-cover ring-2 ring-line"
      />
    );
  }

  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent-text ring-2 ring-accent/20">
      {initials}
    </span>
  );
}

export function Topbar({ user }: { user: TopbarUser }) {
  const label = user.name || user.email || 'Account';
  const isAdmin = user.role === 'ADMIN';

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[color:var(--nav-scrim)] shadow-nav backdrop-blur-xl supports-[backdrop-filter]:bg-[color:var(--nav-scrim)]">
      <div className="flex min-h-16 items-center justify-between gap-2 px-4 py-3 lg:gap-3 lg:px-8">
        <div className="flex min-w-0 items-center">
          <div className="lg:hidden">
            {/* Mark only below sm: the wordmark returns once there is room. */}
            <Logo compact hideTextOnSmall href="/dashboard" />
          </div>

          <div className="relative hidden w-full max-w-md md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Search jobs, companies, contacts..." />
          </div>
        </div>

        {/* A single action group keeps one NotificationBell mounted at every
            breakpoint. Desktop-only actions are hidden below lg; the mobile
            menu renders the same shared navigation list as the sidebar. */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
          <Link href="/profile" className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink lg:flex">
            <UserAvatar user={user} />
            <span>{label}</span>
          </Link>
          {/* Icon-only pill on phones; the fuller switch once space allows. */}
          <ThemeSwitch size="xs" className="sm:hidden" />
          <ThemeSwitch size="sm" className="hidden sm:flex" />
          <NotificationBell />
          <Link href="/jobs/new" className="btn-primary hidden items-center justify-center lg:inline-flex">Add Job</Link>
          <Link href="/settings" className="btn-secondary hidden items-center justify-center lg:inline-flex">Settings</Link>
          <div className="hidden lg:block">
            <SignOutButton />
          </div>
          <div className="lg:hidden">
            <TopbarMobileMenu label={label} isAdmin={isAdmin} />
          </div>
        </div>
      </div>
    </header>
  );
}
