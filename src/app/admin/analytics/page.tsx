import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'Analytics — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminAnalyticsPage() {
  await requireAdmin();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.productEvent.groupBy({
    by: ['name'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { name: 'desc' } },
  });

  const total = rows.reduce((sum, r) => sum + r._count._all, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="title">Product analytics</h1>
        <p className="muted mt-1">First-party events, last 30 days. {total} total events.</p>
      </div>

      <nav aria-label="Admin sections" className="flex flex-wrap gap-2">
        {[
          { href: '/admin', label: 'Overview' },
          { href: '/admin/analytics', label: 'Analytics' },
          { href: '/admin/users', label: 'Users' },
          { href: '/admin/upgrade-requests', label: 'Upgrade requests' },
          { href: '/admin/subscription-history', label: 'Subscription history' },
          { href: '/admin/system', label: 'System' },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="btn-secondary text-xs">
            {item.label}
          </Link>
        ))}
      </nav>

      <section className="card-pad">
        {rows.length === 0 ? (
          <p className="muted">No events recorded yet.</p>
        ) : (
          <table className="table">
            <caption className="sr-only">Event counts</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r._count._all}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
