import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';
import { BackToSiteButton } from './back-to-site-button';

type UserLike = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  role?: string;
};

export function AppShell({ children, user }: { children: React.ReactNode; user: UserLike }) {
  return (
    <div className="flex min-h-screen">
      {/* Presentation only — /admin is independently server-protected, so a
          hidden link is never the authorization boundary. */}
      <SidebarNav isAdmin={user.role === 'ADMIN'} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar user={user} />
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
      <BackToSiteButton />
    </div>
  );
}