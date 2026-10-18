'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Briefcase,
  FileBadge,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Target,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { signOut } from 'next-auth/react';

const mobileLinks = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/queue', label: 'Queue', icon: Target },
  { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/profile', label: 'Profile', icon: UserCircle2 },
  { href: '/career-profile', label: 'Career Profile', icon: Sparkles },
  { href: '/resumes', label: 'Resumes', icon: FileBadge },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function TopbarMobileMenu({ label }: { label: string }) {
  const [open, setOpen] = useState(false);

  async function handleSignOut() {
    await signOut({ callbackUrl: '/login' });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition-colors hover:bg-surface-hover"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open ? (
        /* Opaque, and height-capped so a short viewport scrolls the menu
           instead of letting it run off the screen. */
        <div className="absolute right-0 top-12 z-40 max-h-[calc(100dvh-5rem)] w-[min(88vw,22rem)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card p-3 shadow-lift">
          <div className="mb-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted">{label}</div>

          <div className="grid gap-2">
            <Link href="/jobs/new" onClick={() => setOpen(false)} className="btn-primary inline-flex w-full items-center justify-center gap-1.5">Add Job</Link>
            <button type="button" className="inline-flex items-center justify-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink transition-colors hover:bg-surface-hover"><Bell className="h-4 w-4" />Notifications</button>
          </div>

          <div className="my-3 h-px bg-line" />

          <nav className="grid gap-2">
            {mobileLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="inline-flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink transition-colors hover:bg-surface-hover">
                  <Icon className="h-4 w-4 text-muted" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="my-3 h-px bg-line" />

          <button type="button" onClick={handleSignOut} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger-text transition-colors hover:bg-danger/20">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}