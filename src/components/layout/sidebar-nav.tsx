'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Briefcase, LayoutDashboard, Users, KanbanSquare, Target, FileText, Settings, UserCircle2 } from 'lucide-react';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/queue', label: 'Queue', icon: Target },
  { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/prep', label: 'Prep Packs', icon: FileText },
  { href: '/templates', label: 'Templates', icon: FileText },
  { href: '/profile', label: 'Profile', icon: UserCircle2 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 flex-col border-r border-line bg-[#09111f] p-4 lg:flex">
      <Link href="/" className="mb-6 rounded-2xl border border-line bg-white/5 p-4">
        <div className="text-lg font-semibold">Job Seeker OS</div>
        <div className="mt-1 text-xs text-muted">Personalized job search operating system</div>
      </Link>
      <nav className="space-y-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${active ? 'bg-accent text-white' : 'text-muted hover:bg-white/5 hover:text-ink'}`}>
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
