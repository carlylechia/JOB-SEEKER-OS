import Link from 'next/link';
import { Search } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { TopbarMobileMenu } from './topbar-mobile-menu';
import { SignOutButton } from './sign-out-button';
import { NotificationBell } from './notification-bell';

type TopbarUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
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
        className="h-8 w-8 rounded-full object-cover ring-2 ring-white/10"
      />
    );
  }

  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent ring-2 ring-accent/20">
      {initials}
    </span>
  );
}

export function Topbar({ user }: { user: TopbarUser }) {
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
          <Link href="/profile" className="flex items-center gap-2 rounded-xl border border-line bg-white/5 px-3 py-1.5 text-sm text-muted transition-colors hover:bg-white/10 hover:text-ink">
            <UserAvatar user={user} />
            <span>{label}</span>
          </Link>
          <NotificationBell />
          <Link href="/jobs/new" className="btn-primary inline-flex items-center justify-center">Add Job</Link>
          <Link href="/settings" className="btn-secondary inline-flex items-center justify-center">Settings</Link>
          <SignOutButton />
        </div>

        <div className="lg:hidden">
          <TopbarMobileMenu label={label} />
        </div>
      </div>
    </header>
  );
}
