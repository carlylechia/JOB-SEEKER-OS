import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';
import { BackToSiteButton } from './back-to-site-button';
import { StreakHeartbeat } from './streak-heartbeat';

type UserLike = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  role?: string;
};

/**
 * Authenticated application frame.
 *
 * The frame is intentionally a normal document-scrolling container:
 *   - the topbar is `position: sticky` so it never leaves the viewport
 *   - the sidebar is a full-height sticky column with its own internal scroller
 *   - the main column scrolls with the document
 *
 * None of those ancestors use `overflow: hidden` in the block direction, so
 * the sticky/fixed descendants keep working exactly as expected.
 */
export function AppShell({ children, user }: { children: React.ReactNode; user: UserLike }) {
  return (
    <div className="ambient-canvas flex min-h-dvh w-full overflow-x-hidden">
      <StreakHeartbeat />
      {/* Presentation only — /admin is independently server-protected, so a
          hidden link is never the authorization boundary. */}
      <SidebarNav isAdmin={user.role === 'ADMIN'} user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main id="main-content" className="w-full min-w-0 flex-1 overflow-x-hidden p-4 lg:p-8">
          {children}
        </main>
      </div>
      <BackToSiteButton />
    </div>
  );
}
