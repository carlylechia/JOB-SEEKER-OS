'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpenCheck, Briefcase, LayoutDashboard, Users, KanbanSquare, Target, FileText, FileBadge, Mail, Settings, UserCircle2, CreditCard, Shield, Sparkles } from 'lucide-react';
import { Logo } from '@/components/shared/logo';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/daily-jobs', label: 'Daily Top 5', icon: Sparkles },
  { href: '/queue', label: 'Queue', icon: Target },
  { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/interview-prep', label: 'Interview Prep', icon: BookOpenCheck },
  { href: '/prep', label: 'Prep Notes', icon: FileText },
  { href: '/templates', label: 'Templates', icon: FileText },
  { href: '/profile', label: 'Profile', icon: UserCircle2 },
  { href: '/career-profile', label: 'Career Profile', icon: Sparkles },
  { href: '/resumes', label: 'Resumes', icon: FileBadge },
  { href: '/application-materials', label: 'Application materials', icon: Mail },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/settings/billing', label: 'Plan & Billing', icon: CreditCard },
];

/** Only rendered for admins. The server still enforces access independently —
 *  hiding the link is presentation, not authorization. */
export function SidebarNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-sidebar p-4 lg:flex">
      <div className="mb-6 rounded-2xl border border-line bg-surface p-4">
        <Logo href="/dashboard" />
      </div>
      <nav className="space-y-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-accent font-medium text-accent-ink'
                  : 'text-muted hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
        {isAdmin ? (
          <Link
            href="/admin"
            aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
            className={`mt-2 flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
              pathname.startsWith('/admin')
                ? 'border-transparent bg-accent font-medium text-accent-ink'
                : 'border-line text-muted hover:bg-surface-sunken hover:text-ink'
            }`}
          >
            <Shield className="h-4 w-4" />
            Admin
          </Link>
        ) : null}
      </nav>
    </aside>
  );
}