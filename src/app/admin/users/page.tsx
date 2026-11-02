import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { PlanBadge, StatusBadge } from '@/components/billing/plan-badge';
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
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<AdminUsersSearchParams>;
}) {
  await requireAdmin();

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="title">Users</h1>
        <p className="muted">
          {total} {total === 1 ? 'user' : 'users'}
        </p>
      </div>

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

      {/* Table — becomes cards on small screens */}
      <div className="table-wrap hidden md:block">
        <table className="table">
          <caption className="sr-only">User directory</caption>
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Role</th>
              <th scope="col">Plan</th>
              <th scope="col">Status</th>
              <th scope="col">Trial ends</th>
              <th scope="col">Plan ends</th>
              <th scope="col">Joined</th>
              <th className="text-right" scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <div className="font-medium text-ink">{user.name ?? '—'}</div>
                  <div className="text-xs text-muted">{user.email}</div>
                  {!user.emailVerified ? (
                    <span className="mt-1 inline-block text-[11px] text-warn">Unverified email</span>
                  ) : null}
                </td>
                <td>{user.role}</td>
                <td>
                  {user.subscription ? <PlanBadge plan={user.subscription.plan.code as never} /> : '—'}
                </td>
                <td>{user.subscription ? <StatusBadge status={user.subscription.status} /> : '—'}</td>
                <td className="whitespace-nowrap text-xs">
                  {user.subscription?.trialEndsAt
                    ? new Date(user.subscription.trialEndsAt).toLocaleDateString()
                    : '—'}
                </td>
                <td className="whitespace-nowrap text-xs">
                  {user.subscription?.endsAt
                    ? new Date(user.subscription.endsAt).toLocaleDateString()
                    : '—'}
                </td>
                <td className="whitespace-nowrap text-xs">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="text-right">
                  <Link
                    href={`/admin/users/${user.id}`}
                    className="btn-secondary px-3 py-1 text-xs"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-3 md:hidden">
        {users.map((user) => (
          <li key={user.id} className="card-pad">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{user.name ?? '—'}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
              </div>
              {user.subscription ? <PlanBadge plan={user.subscription.plan.code as never} /> : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {user.subscription ? <StatusBadge status={user.subscription.status} /> : null}
              <span className="text-xs text-muted">{user.role}</span>
            </div>
            <Link href={`/admin/users/${user.id}`} className="btn-secondary mt-3 w-full text-xs">
              View user
            </Link>
          </li>
        ))}
      </ul>

      {users.length === 0 ? (
        <p className="muted">No users match these filters.</p>
      ) : null}

      {/* Pagination */}
      <Pagination page={currentPage} totalPages={totalPages} hrefForPage={buildUrl} label="Admin users pagination" />
    </div>
  );
}
