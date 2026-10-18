import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { PlanBadge, StatusBadge } from '@/components/billing/plan-badge';

export const metadata: Metadata = {
  title: 'Users — Admin — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

type SearchParams = {
  q?: string;
  access?: string;
  role?: string;
  status?: string;
  page?: string;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 120);
  const access = ['all', 'trial', 'paid', 'free'].includes(params.access ?? '')
    ? (params.access as string)
    : 'all';
  const role = ['USER', 'ADMIN'].includes(params.role ?? '') ? (params.role as string) : '';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const userWhere: Record<string, unknown> = {};
  if (role) userWhere.role = role;
  if (q) {
    userWhere.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }

  const subscriptionWhere: Record<string, unknown> = {};
  if (access === 'trial') subscriptionWhere.status = 'TRIALING';
  if (access === 'paid') {
    subscriptionWhere.status = 'ACTIVE';
    subscriptionWhere.plan = { code: { in: ['PRO', 'PREMIUM'] } };
  }
  if (access === 'free') {
    subscriptionWhere.status = 'ACTIVE';
    subscriptionWhere.plan = { code: 'FREE' };
  }

  const where =
    Object.keys(subscriptionWhere).length > 0
      ? { AND: [userWhere, { subscription: subscriptionWhere }] }
      : userWhere;

  const [total, users] = await Promise.all([
    prisma.user.count({ where: where as never }),
    prisma.user.findMany({
      where: where as never,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      // Selective fields — no password hashes, tokens, or private content.
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
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildUrl = (nextPage: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (access !== 'all') sp.set('access', access);
    if (role) sp.set('role', role);
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
            defaultValue={q}
            placeholder="Name or email"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="access" className="mb-1.5 block text-sm text-ink">
            Access
          </label>
          <select id="access" name="access" defaultValue={access} className="select">
            <option value="all">All</option>
            <option value="trial">Trialing</option>
            <option value="paid">Paid</option>
            <option value="free">Free</option>
          </select>
        </div>
        <div>
          <label htmlFor="role" className="mb-1.5 block text-sm text-ink">
            Role
          </label>
          <select id="role" name="role" defaultValue={role} className="select">
            <option value="">All</option>
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
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
              <th scope="col">
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
                <td>
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
      {totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={buildUrl(page - 1)} className="btn-secondary text-xs">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="muted text-xs">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={buildUrl(page + 1)} className="btn-secondary text-xs">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}