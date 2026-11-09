import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { AdminUsersTable } from '@/components/admin/admin-users-table';
import { Pagination } from '@/components/ui/pagination';
import {
  ADMIN_USERS_PAGE_SIZE,
  buildAdminUserWhere,
  parseAdminUserFilters,
} from '@/lib/admin/user-filters';

export const metadata: Metadata = {
  title: 'Users — Admin — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type AdminUsersSearchParams = {
  q?: string;
  access?: string;
  role?: string;
  plan?: string;
  status?: string;
  joinedFrom?: string;
  joinedTo?: string;
  page?: string;
  /** Result handoff from the user-detail danger zone. */
  deleted?: string;
  filesPending?: string;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<AdminUsersSearchParams>;
}) {
  const admin = await requireAdmin();

  const params = (await searchParams) as AdminUsersSearchParams;
  const filters = parseAdminUserFilters({
    q: params.q ?? '',
    access: params.access ?? '',
    role: params.role ?? '',
    plan: params.plan ?? '',
    status: params.status ?? '',
    joinedFrom: params.joinedFrom ?? '',
    joinedTo: params.joinedTo ?? '',
  });

  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const justDeleted = params.deleted === '1';
  const filesPending = Math.max(0, Number.parseInt(params.filesPending ?? '0', 10) || 0);
  const where = buildAdminUserWhere(filters);
  const total = await prisma.user.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_USERS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const users = await prisma.user.findMany({
    where,
    take: ADMIN_USERS_PAGE_SIZE,
    skip: (currentPage - 1) * ADMIN_USERS_PAGE_SIZE,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      createdAt: true,
      subscription: {
        select: {
          status: true,
          trialEndsAt: true,
          endsAt: true,
          plan: { select: { code: true } },
        },
      },
    },
  });

  const buildUrl = (nextPage: number) => {
    const sp = new URLSearchParams();
    if (filters.q) sp.set('q', filters.q);
    if (filters.access !== 'all') sp.set('access', filters.access);
    if (filters.role) sp.set('role', filters.role);
    if (filters.plan) sp.set('plan', filters.plan);
    if (filters.joinedFrom) sp.set('joinedFrom', filters.joinedFrom);
    if (filters.joinedTo) sp.set('joinedTo', filters.joinedTo);
    if (nextPage > 1) sp.set('page', String(nextPage));
    const qs = sp.toString();
    return qs ? `/admin/users?${qs}` : '/admin/users';
  };

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: 'Users' }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="title">Users</h1>
        <p className="muted">
          {total} {total === 1 ? 'user' : 'users'}
        </p>
      </div>

      {justDeleted ? (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            filesPending > 0
              ? 'border-warn/30 bg-warn/[0.06] text-warn-text'
              : 'border-success/30 bg-success/[0.06] text-success-text'
          }`}
        >
          {filesPending > 0
            ? `User deleted. ${filesPending} stored file${filesPending === 1 ? '' : 's'} could not be removed yet and ${filesPending === 1 ? 'was' : 'were'} queued for automatic retry.`
            : 'User deleted.'}
        </div>
      ) : null}

      {/* Filters */}
      <form method="get" action="/admin/users" className="card-pad flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="q" className="mb-1.5 block text-sm text-ink">
            Search
          </label>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Name or email"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="access" className="mb-1.5 block text-sm text-ink">
            Access
          </label>
          <select id="access" name="access" defaultValue={filters.access} className="select">
            <option value="all">All</option>
            <option value="trial">Trialing</option>
            <option value="paid">Paid</option>
            <option value="free">Free</option>
          </select>
        </div>
        <div>
          <label htmlFor="plan" className="mb-1.5 block text-sm text-ink">
            Plan
          </label>
          <select id="plan" name="plan" defaultValue={filters.plan ?? ''} className="select">
            <option value="">All plans</option>
            <option value="FREE">Free</option>
            <option value="PRO">Pro</option>
            <option value="PREMIUM">Premium</option>
            <option value="NONE">No plan</option>
          </select>
        </div>
        <div>
          <label htmlFor="role" className="mb-1.5 block text-sm text-ink">
            Role
          </label>
          <select id="role" name="role" defaultValue={filters.role ?? ''} className="select">
            <option value="">All</option>
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <div>
          <label htmlFor="joinedFrom" className="mb-1.5 block text-sm text-ink">
            Joined from
          </label>
          <input
            id="joinedFrom"
            type="date"
            name="joinedFrom"
            defaultValue={filters.joinedFrom}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="joinedTo" className="mb-1.5 block text-sm text-ink">
            Joined until
          </label>
          <input
            id="joinedTo"
            type="date"
            name="joinedTo"
            defaultValue={filters.joinedTo}
            className="input"
          />
        </div>
        <button type="submit" className="btn-secondary">
          Filter
        </button>
      </form>

      <AdminUsersTable
        currentAdminId={admin.id}
        users={users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          emailVerified: Boolean(user.emailVerified),
          createdAt: user.createdAt.toISOString(),
          subscription: user.subscription
            ? {
                status: user.subscription.status,
                trialEndsAt: user.subscription.trialEndsAt?.toISOString() ?? null,
                endsAt: user.subscription.endsAt?.toISOString() ?? null,
                plan: { code: user.subscription.plan.code },
              }
            : null,
        }))}
      />

      {/* Pagination */}
      <Pagination page={currentPage} totalPages={totalPages} hrefForPage={buildUrl} label="Admin users pagination" />
    </div>
  );
}
