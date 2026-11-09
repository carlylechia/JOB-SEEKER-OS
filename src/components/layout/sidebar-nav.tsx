'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/shared/logo';
import { SignOutButton } from './sign-out-button';
import { appNavItems } from './nav-items';

type SidebarUser = {
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

function initials(user: SidebarUser) {
  return (user.name ?? user.email ?? '?')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Only rendered for admins. The server still enforces access independently —
 *  hiding the link is presentation, not authorization. */
export function SidebarNav({
  isAdmin = false,
  user,
}: {
  isAdmin?: boolean;
  user: SidebarUser;
}) {
  const pathname = usePathname();
  const items = appNavItems(isAdmin);

  // Pick the most specific match so /settings/billing activates Billing only,
  // not both Billing and Settings.
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside
      aria-label="Application sidebar"
      className="sticky top-0 z-20 hidden h-dvh max-h-dvh w-72 shrink-0 flex-col overflow-hidden border-r border-line bg-sidebar p-4 lg:flex"
    >
      <div className="mb-4 shrink-0 rounded-2xl border border-line bg-surface p-4">
        <Logo href="/dashboard" />
      </div>

      {/* Only the navigation scrolls. A short viewport never pushes the
          account footer off screen, and a long navigation never moves the
          main document. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <nav className="space-y-1 pb-4" aria-label="Main navigation">
          {items.map((item) => {
            const isActive = item.href === activeHref;
            const Icon = item.icon;
            const admin = Boolean(item.adminOnly);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                  admin ? 'mt-2 border' : ''
                } ${
                  isActive
                    ? 'border-transparent bg-accent font-medium text-accent-ink'
                    : admin
                      ? 'border-line text-muted hover:bg-surface-sunken hover:text-ink'
                      : 'text-muted hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Pinned footer: identity and the account escape hatch stay visible. */}
      <div className="shrink-0 border-t border-line pt-3">
        <Link
          href="/profile"
          className="flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-surface-sunken"
          aria-label="Open your profile"
        >
          {user.image ? (
            <img
              src={user.image}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-line"
            />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent-text ring-2 ring-accent/20">
              {initials(user)}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">
              {user.name || user.email || 'Account'}
            </span>
            {user.name && user.email ? (
              <span className="block truncate text-xs text-muted">{user.email}</span>
            ) : null}
          </span>
        </Link>
        <div className="mt-2">
          <SignOutButton fullWidth />
        </div>
      </div>
    </aside>
  );
}
