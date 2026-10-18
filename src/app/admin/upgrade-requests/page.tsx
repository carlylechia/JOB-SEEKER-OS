import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { StatusBadge, PlanBadge } from '@/components/billing/plan-badge';
import { buildMailtoUrl, buildWhatsappUrl, whatsappPrefill } from '@/lib/billing/upgrade-requests';

export const metadata: Metadata = {
  title: 'Upgrade Requests — Admin — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

type SearchParams = {
  q?: string;
  status?: string;
  plan?: string;
  page?: string;
};

export default async function AdminUpgradeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 120);
  const status = ['PENDING', 'CONTACTED', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(
    params.status ?? '',
  )
    ? (params.status as string)
    : '';
  const plan = ['PRO', 'PREMIUM'].includes(params.plan ?? '') ? (params.plan as string) : '';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (plan) where.requestedPlan = plan;
  if (q) {
    where.OR = [
      { message: { contains: q, mode: 'insensitive' } },
      { contactEmail: { contains: q, mode: 'insensitive' } },
      { whatsappNumber: { contains: q, mode: 'insensitive' } },
      { user: { is: { email: { contains: q, mode: 'insensitive' } } } },
      { user: { is: { name: { contains: q, mode: 'insensitive' } } } },
    ];
  }

  const [total, requests] = await Promise.all([
    prisma.upgradeRequest.count({ where: where as never }),
    prisma.upgradeRequest.findMany({
      where: where as never,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        requestedPlan: true,
        currentPlanSnapshot: true,
        status: true,
        contactMethod: true,
        contactEmail: true,
        whatsappNumber: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            subscription: { select: { plan: { select: { code: true } } } },
          },
        },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildUrl = (nextPage: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (status) sp.set('status', status);
    if (plan) sp.set('plan', plan);
    if (nextPage > 1) sp.set('page', String(nextPage));
    const qs = sp.toString();
    return qs ? `/admin/upgrade-requests?${qs}` : '/admin/upgrade-requests';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="title">Upgrade requests</h1>
        <p className="muted">
          {total} {total === 1 ? 'request' : 'requests'}
        </p>
      </div>

      <form method="get" action="/admin/upgrade-requests" className="card-pad flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="q" className="mb-1.5 block text-sm text-ink">
            Search
          </label>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="User, email, message or number"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="status" className="mb-1.5 block text-sm text-ink">
            Status
          </label>
          <select id="status" name="status" defaultValue={status} className="select">
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="CONTACTED">Contacted</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <div>
          <label htmlFor="plan" className="mb-1.5 block text-sm text-ink">
            Plan
          </label>
          <select id="plan" name="plan" defaultValue={plan} className="select">
            <option value="">All</option>
            <option value="PRO">Pro</option>
            <option value="PREMIUM">Premium</option>
          </select>
        </div>
        <button type="submit" className="btn-secondary">
          Filter
        </button>
      </form>

      {/* Desktop table */}
      <div className="table-wrap hidden md:block">
        <table className="table">
          <caption className="sr-only">Upgrade requests</caption>
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Requested</th>
              <th scope="col">Current plan</th>
              <th scope="col">Contact</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => {
              const currentPlan =
                request.currentPlanSnapshot ?? request.user.subscription?.plan.code ?? 'FREE';
              return (
                <tr key={request.id}>
                  <td>
                    <div className="font-medium text-ink">{request.user.name ?? '—'}</div>
                    <div className="text-xs text-muted">{request.user.email}</div>
                  </td>
                  <td>
                    <PlanBadge plan={request.requestedPlan} />
                  </td>
                  <td>
                    <PlanBadge plan={currentPlan as never} />
                  </td>
                  <td className="text-xs">
                    <div>{request.contactMethod === 'EMAIL' ? 'Email' : 'WhatsApp'}</div>
                    <div className="text-muted">
                      {request.contactMethod === 'EMAIL'
                        ? request.contactEmail
                        : request.whatsappNumber}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={request.status} />
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {new Date(request.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div className="flex gap-2">
                      {request.contactEmail ? (
                        <a
                          href={
                            buildMailtoUrl(
                              request.contactEmail,
                              `Your teChia Jobs ${request.requestedPlan} upgrade request`,
                            ) ?? '#'
                          }
                          className="btn-secondary px-3 py-1 text-xs"
                        >
                          Email
                        </a>
                      ) : null}
                      {buildWhatsappUrl(request.whatsappNumber) ? (
                        <a
                          href={
                            buildWhatsappUrl(
                              request.whatsappNumber,
                              whatsappPrefill(request.user.name, request.requestedPlan),
                            ) ?? '#'
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary px-3 py-1 text-xs"
                        >
                          WhatsApp
                        </a>
                      ) : null}
                      <Link
                        href={`/admin/upgrade-requests/${request.id}`}
                        className="btn-secondary px-3 py-1 text-xs"
                      >
                        Open
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-3 md:hidden">
        {requests.map((request) => (
          <li key={request.id} className="card-pad">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{request.user.name ?? request.user.email}</p>
                <p className="truncate text-xs text-muted">{request.user.email}</p>
              </div>
              <StatusBadge status={request.status} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PlanBadge plan={request.requestedPlan} />
              <span className="text-xs text-muted">
                {request.contactMethod === 'EMAIL' ? request.contactEmail : request.whatsappNumber}
              </span>
            </div>
            <Link
              href={`/admin/upgrade-requests/${request.id}`}
              className="btn-secondary mt-3 w-full text-xs"
            >
              Review request
            </Link>
          </li>
        ))}
      </ul>

      {requests.length === 0 ? <p className="muted">No requests match these filters.</p> : null}

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