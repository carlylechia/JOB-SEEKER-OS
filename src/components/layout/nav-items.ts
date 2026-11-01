import {
  BookOpenCheck,
  Briefcase,
  CreditCard,
  FileBadge,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  Settings,
  Shield,
  Sparkles,
  Target,
  UserCircle2,
  Users,
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
 */
export const APP_NAV_ITEMS: readonly AppNavItem[] = [
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
  { href: '/admin', label: 'Admin', icon: Shield, adminOnly: true },
];

export function appNavItems(isAdmin: boolean): AppNavItem[] {
  return APP_NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}
