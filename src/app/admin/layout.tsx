import type { ReactNode } from 'react';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/**
 * Admin layout.
 *
 * Every /admin/* page is protected at the SERVER level here. Individual pages
 * also call `requireAdmin()` — this layout is the outer gate, not the only one.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return <div className="min-w-0">{children}</div>;
}