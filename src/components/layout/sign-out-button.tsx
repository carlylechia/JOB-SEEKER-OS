'use client';

import { LogOut } from 'lucide-react';
import { signOut } from 'next-auth/react';

export function SignOutButton({ fullWidth = false }: { fullWidth?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/login' })}
      className={`btn-secondary inline-flex items-center justify-center gap-2 ${fullWidth ? 'w-full' : ''}`}
      aria-label="Sign out"
    >
      <LogOut className="h-4 w-4" />
      <span className={fullWidth ? '' : 'hidden xl:inline'}>Sign out</span>
    </button>
  );
}
