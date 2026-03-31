'use client';

import Link from 'next/link';
import { Bell, Search } from 'lucide-react';

export function Topbar() {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-background/85 px-4 py-4 backdrop-blur lg:px-8">
      <div className="relative hidden w-full max-w-md md:block">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
        <input className="input pl-9" placeholder="Search jobs, companies, contacts..." />
      </div>
      <div className="ml-auto flex items-center gap-3">
        <button className="btn-secondary"><Bell className="h-4 w-4" /></button>
        <Link href="/jobs/new" className="btn-primary">Add Job</Link>
      </div>
    </div>
  );
}
