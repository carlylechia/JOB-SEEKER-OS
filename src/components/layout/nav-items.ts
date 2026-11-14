import {
  KanbanSquare,
  LayoutDashboard,
  Search,
  Settings,
  Shield,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Rendered only for administrators. Authorization is still enforced server-side. */
  adminOnly?: boolean;
};

/**
 * The single source of truth for app navigation.
 *
 * Both the desktop sidebar and the mobile menu render this list, so a feature
 * can never be present on one breakpoint and missing on the other. Admin is the
 * only role-gated entry; hiding it is presentation only — `/admin` and every
 * `/api/admin/*` route enforce the role independently on the server.
 *
 * FIVE primary destinations. Every other capability is reachable from one of
 * them:
 *
 *   Overview            → dashboard, daily queue, interviews, follow-ups
 *   Find Jobs           → saved jobs, discovery, daily snapshots, public catalog
 *   Applications        → pipeline, application records, contacts, offers
 *   Application Studio  → profile, resumes, writing, research, interview prep
 *   Settings            → account, preferences, billing, admin (role-gated)
 *
 * Legacy URLs stay live (see `legacy-routes.ts`). They are simply no longer
 * competing entries in the primary navigation.
 */
export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/jobs', label: 'Find Jobs', icon: Search },
  { href: '/pipeline', label: 'Applications', icon: KanbanSquare },
  { href: '/studio', label: 'Application Studio', icon: Sparkles },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/admin', label: 'Admin', icon: Shield, adminOnly: true },
];

export function appNavItems(isAdmin: boolean): AppNavItem[] {
  return APP_NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}
