import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { getEmailOutboxHealth } from '@/lib/billing/email-outbox';

export const metadata: Metadata = {
  title: 'System — Admin — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminSystemPage() {
  await requireAdmin();

  const [email, dbCheck, monetization, plans, failedEmails] = await Promise.all([
    getEmailOutboxHealth(),
    // Lightweight connectivity probe — no secrets, no full scans.
    prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`.then(
      () => true,
      () => false,
    ),
    prisma.monetizationConfig.findUnique({ where: { id: 'global' } }),
    prisma.plan.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, active: true, monthlyPrice: true, yearlyPrice: true, currency: true },
    }),
    // Only the safe error string — never payload or recipient.
    prisma.emailOutbox.findMany({
      where: { status: 'FAILED' },
      take: 10,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, type: true, attempts: true, lastError: true, updatedAt: true },
    }),
  ]);

  const health = [
    { label: 'Database reachable', ok: dbCheck },
    { label: 'Email configured', ok: email.configured },
    { label: 'Monetization initialized', ok: Boolean(monetization?.initializedAt) },
    { label: 'Monetization live', ok: Boolean(monetization?.enabledAt) },
  ];

  return (
    <div className="space-y-5">
      <h1 className="title">System</h1>

      <section aria-labelledby="health-heading" className="card-pad">
        <h2 id="health-heading" className="text-sm font-semibold text-ink">
          Health
        </h2>
        <ul className="mt-3 space-y-2">
          {health.map((item) => (
            <li key={item.label} className="flex items-center justify-between text-sm">
              <span className="text-ink">{item.label}</span>
              <span className={item.ok ? 'text-[#136B45]' : 'text-[#9B2C2C]'}>
                {item.ok ? 'OK' : 'Attention needed'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="plans-heading" className="card-pad">
        <h2 id="plans-heading" className="text-sm font-semibold text-ink">
          Plan catalogue
        </h2>
        <div className="table-wrap mt-3">
          <table className="table">
            <caption className="sr-only">Configured plans</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Monthly</th>
                <th scope="col">Annual</th>
                <th scope="col">Currency</th>
                <th scope="col">Active</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.code}>
                  <td className="font-medium">{plan.code}</td>
                  <td>{plan.name}</td>
                  <td className="text-xs">
                    {plan.monthlyPrice === null ? 'Contact us' : `${plan.monthlyPrice} minor units`}
                  </td>
                  <td className="text-xs">
                    {plan.yearlyPrice === null ? 'Contact us' : `${plan.yearlyPrice} minor units`}
                  </td>
                  <td className="text-xs">{plan.currency}</td>
                  <td className="text-xs">{plan.active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          Plans are assigned to users, not edited here. Pricing changes are a deliberate,
          migration-backed operation.
        </p>
      </section>

      <section aria-labelledby="email-heading" className="card-pad">
        <h2 id="email-heading" className="text-sm font-semibold text-ink">
          Email outbox
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Pending</dt>
            <dd className="text-ink">{email.pending}</dd>
          </div>
          <div>
            <dt className="text-muted">Processing</dt>
            <dd className="text-ink">{email.processing}</dd>
          </div>
          <div>
            <dt className="text-muted">Failed</dt>
            <dd className={email.failed > 0 ? 'font-semibold text-[#9B2C2C]' : 'text-ink'}>
              {email.failed}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Sent</dt>
            <dd className="text-ink">{email.sent}</dd>
          </div>
        </dl>

        {failedEmails.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-ink">Recent failures</h3>
            <ul className="mt-2 space-y-2">
              {failedEmails.map((item) => (
                <li key={item.id} className="rounded-xl bg-black/[0.03] p-3 text-xs">
                  <p className="text-ink">
                    {item.type} · {item.attempts} attempts
                  </p>
                  <p className="mt-1 break-words text-muted">{item.lastError ?? 'Unknown error'}</p>
                  <p className="mt-1 text-muted">
                    {new Date(item.updatedAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}