import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';

type UserLike = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export function AppShell({ children, user }: { children: React.ReactNode; user: UserLike }) {
  return (
    <div className="flex min-h-screen">
      <SidebarNav />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar user={user} />
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
