'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Briefcase,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
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
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white/5 text-ink transition hover:bg-white/10"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-30 w-[min(88vw,22rem)] rounded-2xl border border-line bg-[#09111f]/95 p-3 shadow-soft backdrop-blur">
          <div className="mb-3 rounded-xl border border-line bg-white/5 px-3 py-2 text-sm text-muted">
            {label}
          </div>

          <div className="grid gap-2">
            <Link
              href="/jobs/new"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-soft transition hover:opacity-95"
            >
              Add Job
            </Link>

            <button
              type="button"
              className="inline-flex items-center gap-3 rounded-xl border border-line bg-white/5 px-4 py-3 text-sm text-ink transition hover:bg-white/10"
            >
              <Bell className="h-4 w-4" />
              Notifications
            </button>
          </div>

          <div className="my-3 h-px bg-white/10" />

          <nav className="grid gap-2">
            {mobileLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-3 rounded-xl border border-line bg-white/5 px-4 py-3 text-sm text-ink transition hover:bg-white/10"
                >
                  <Icon className="h-4 w-4 text-muted" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="my-3 h-px bg-white/10" />

          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200 transition hover:bg-red-500/15"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}