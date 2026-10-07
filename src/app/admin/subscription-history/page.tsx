import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'Subscription History — Admin — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminSubscriptionHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const [total, events] = await Promise.all([
    prisma.subscriptionEvent.count(),
    prisma.subscriptionEvent.findMany({
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        previousPlanCode: true,
        newPlanCode: true,
        previousStatus: true,
        newStatus: true,
        reason: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
        actorAdmin: { select: { email: true } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <h1 className="title">Subscription history</h1>
      <p className="muted">
        {total} recorded {total === 1 ? 'change' : 'changes'}
      </p>

      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">All subscription changes</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">User</th>
              <th scope="col">Event</th>
              <th scope="col">Plan change</th>
              <th scope="col">Status change</th>
              <th scope="col">Reason</th>
              <th scope="col">By</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td className="whitespace-nowrap text-xs">
                  {new Date(event.createdAt).toLocaleString()}
                </td>
                <td>
                  <Link
                    href={`/admin/users/${event.user.id}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {event.user.name ?? event.user.email}
                  </Link>
                </td>
                <td className="text-xs">{event.type.replace(/_/g, ' ')}</td>
                <td className="text-xs">
                  {event.previousPlanCode ?? '—'} → {event.newPlanCode ?? '—'}
                </td>
                <td className="text-xs">
                  {event.previousStatus ?? '—'} → {event.newStatus ?? '—'}
                </td>
                <td className="max-w-xs truncate text-xs">{event.reason ?? '—'}</td>
                <td className="text-xs">{event.actorAdmin?.email ?? 'System'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {events.length === 0 ? <p className="muted">No history recorded yet.</p> : null}

      {totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={`/admin/subscription-history?page=${page - 1}`} className="btn-secondary text-xs">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="muted text-xs">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/admin/subscription-history?page=${page + 1}`} className="btn-secondary text-xs">
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