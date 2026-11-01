'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/shared/logo';
import { appNavItems } from './nav-items';

/** Only rendered for admins. The server still enforces access independently —
 *  hiding the link is presentation, not authorization. */
export function SidebarNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const items = appNavItems(isAdmin);

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-sidebar p-4 lg:flex">
      <div className="mb-6 rounded-2xl border border-line bg-surface p-4">
        <Logo href="/dashboard" />
      </div>
      <nav className="space-y-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          const admin = Boolean(item.adminOnly);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                admin ? 'mt-2 border' : ''
              } ${
                active
                  ? 'border-transparent bg-accent font-medium text-accent-ink'
                  : admin
                    ? 'border-line text-muted hover:bg-surface-sunken hover:text-ink'
                    : 'text-muted hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
