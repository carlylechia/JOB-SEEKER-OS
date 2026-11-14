/**
 * Legacy route compatibility.
 *
 * The navigation consolidation hides redundant destinations without deleting
 * their backend systems. Every legacy URL keeps working:
 *
 *   - `redirect` routes issue a server redirect to the canonical surface.
 *   - `kept` routes remain fully functional and are linked from Application
 *     Studio or the relevant workspace.
 *
 * This list is the reviewable contract for "what moved where". It is also
 * asserted by `tests/navigation.test.ts`.
 */
export type LegacyRoute = {
  href: string;
  canonical: string;
  /** True when the route itself redirects; false when the page is still served. */
  redirect: boolean;
  reason: string;
};

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  {
    href: '/queue',
    canonical: '/dashboard#daily-queue',
    redirect: true,
    reason: 'The dashboard is the only daily queue surface; the queue engine is unchanged.',
  },
  {
    href: '/daily-jobs',
    canonical: '/jobs',
    redirect: false,
    reason: 'Daily Top 5 remains a discovery view reachable from Find Jobs.',
  },
  {
    href: '/contacts',
    canonical: '/pipeline',
    redirect: false,
    reason: 'Contacts remain a supporting record for applications.',
  },
  {
    href: '/prep',
    canonical: '/interview-prep',
    redirect: false,
    reason: 'Legacy prep notes remain readable and are migrated into interview context.',
  },
  {
    href: '/career-profile',
    canonical: '/studio',
    redirect: false,
    reason: 'Reachable from Application Studio as the candidate foundation.',
  },
  {
    href: '/resumes',
    canonical: '/studio',
    redirect: false,
    reason: 'Reachable from Application Studio as the resume library.',
  },
  {
    href: '/application-materials',
    canonical: '/studio',
    redirect: false,
    reason: 'Reachable from Application Studio as the writing library.',
  },
  {
    href: '/templates',
    canonical: '/studio',
    redirect: false,
    reason: 'Reachable from Application Studio as reusable templates.',
  },
];
