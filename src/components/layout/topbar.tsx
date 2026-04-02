import Link from 'next/link';
import { Bell, LogOut, Search } from 'lucide-react';
import { signOut } from '@/auth';

export function Topbar({ user }: { user: { name?: string | null; email?: string | null } }) {
  async function handleSignOut() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  const label = user.name || user.email || 'Account';

  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-background/85 px-4 py-4 backdrop-blur lg:px-8">
      <div className="relative hidden w-full max-w-md md:block">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
        <input className="input pl-9" placeholder="Search jobs, companies, contacts..." />
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden rounded-xl border border-line bg-white/5 px-3 py-2 text-sm text-muted md:inline-flex">{label}</span>
        <button className="btn-secondary" aria-label="Notifications"><Bell className="h-4 w-4" /></button>
        <Link href="/jobs/new" className="btn-primary">Add Job</Link>
        <form action={handleSignOut}>
          <button type="submit" className="btn-secondary" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
        </form>
      </div>
    </div>
  );
}
