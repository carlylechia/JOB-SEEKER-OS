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
 *   - the sidebar is fixed to the viewport with its own internal scroller
 *   - the main column scrolls with the document and is offset by the sidebar
 *
 * `overflow-x-clip` contains stray inline content without creating a block
 * scrollport. `overflow-x-hidden` would compute the block axis to `auto` and
 * silently break the sticky topbar.
 */
export function AppShell({ children, user }: { children: React.ReactNode; user: UserLike }) {
  return (
    <div className="ambient-canvas flex min-h-dvh w-full overflow-x-clip">
      <StreakHeartbeat />
      {/* Presentation only — /admin is independently server-protected, so a
          hidden link is never the authorization boundary. */}
      <SidebarNav isAdmin={user.role === 'ADMIN'} user={user} />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-72">
        <Topbar user={user} />
        <main id="main-content" className="w-full min-w-0 flex-1 overflow-x-clip p-4 lg:p-8">
          {children}
        </main>
      </div>
      <BackToSiteButton />
    </div>
  );
}
