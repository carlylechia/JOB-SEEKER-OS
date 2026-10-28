import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { getEmailOutboxHealth } from '@/lib/billing/email-outbox';
import { listSourceHealth, recentCatalogRuns } from '@/lib/job-discovery/source-health';

export const metadata: Metadata = {
  title: 'System — Admin — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminSystemPage() {
  await requireAdmin();

  const [email, dbCheck, monetization, plans, failedEmails, sourceHealth, catalogRuns, jobSourcesCount] = await Promise.all([
    getEmailOutboxHealth(),
    prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`.then(
      () => true,
      () => false,
    ),
    prisma.monetizationConfig.findUnique({ where: { id: 'global' } }),
    prisma.plan.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, active: true, monthlyPrice: true, yearlyPrice: true, currency: true },
    }),
    prisma.emailOutbox.findMany({
      where: { status: 'FAILED' },
      take: 10,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, type: true, attempts: true, lastError: true, updatedAt: true },
    }),
    listSourceHealth(),
    recentCatalogRuns(5),
    prisma.jobSource.count(),
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
              <span className={item.ok ? 'text-success-text' : 'text-danger-text'}>
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
            <dd className={email.failed > 0 ? 'font-semibold text-danger-text' : 'text-ink'}>
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
                <li key={item.id} className="rounded-xl bg-surface-sunken p-3 text-xs">
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
      <section aria-labelledby="sources-heading" className="card-pad">
        <div className="flex items-center justify-between">
          <h2 id="sources-heading" className="text-sm font-semibold text-ink">
            Job discovery providers
          </h2>
          <span className="text-xs text-muted">{jobSourcesCount} employer boards registered</span>
        </div>
        <div className="table-wrap mt-3">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Type</th>
                <th scope="col">Configured</th>
                <th scope="col">Enabled</th>
                <th scope="col">Boards</th>
                <th scope="col">Jobs Accepted</th>
                <th scope="col">Avg Latency</th>
                <th scope="col">Quota / Rate Limit</th>
                <th scope="col">Last success</th>
              </tr>
            </thead>
            <tbody>
              {sourceHealth.map((s) => (
                <tr key={s.sourceId}>
                  <td className="font-medium">{s.displayName}</td>
                  <td className="text-xs">{s.connectorType}</td>
                  <td className="text-xs">{s.configured ? 'Yes' : 'No'}</td>
                  <td className="text-xs">{s.enabled ? 'Yes' : 'No'}</td>
                  <td className="text-xs">{s.boardsAttempted > 0 ? `${s.boardsSucceeded}/${s.boardsAttempted}` : '—'}</td>
                  <td className="text-xs">{s.catalogJobsAccepted > 0 ? s.catalogJobsAccepted : '—'}</td>
                  <td className="text-xs">{s.avgLatencyMs ? `${s.avgLatencyMs}ms` : '—'}</td>
                  <td className="text-xs">{s.quotaState ?? (s.rateLimitRemaining != null ? `${s.rateLimitRemaining} left` : 'Normal')}</td>
                  <td className="text-xs">{s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {catalogRuns.length > 0 ? (
        <section aria-labelledby="catalog-runs-heading" className="card-pad">
          <h2 id="catalog-runs-heading" className="text-sm font-semibold text-ink">
            Recent catalog sync runs
          </h2>
          <div className="table-wrap mt-3">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Trigger</th>
                  <th scope="col">Status</th>
                  <th scope="col">Retrieved</th>
                  <th scope="col">Created</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Closed</th>
                  <th scope="col">Duration</th>
                </tr>
              </thead>
              <tbody>
                {catalogRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="text-xs">{new Date(run.startedAt).toLocaleString()}</td>
                    <td className="text-xs">{run.trigger}</td>
                    <td className="text-xs font-medium">
                      <span className={run.status === 'COMPLETED' ? 'text-success-text' : run.status === 'PARTIAL' ? 'text-amber-600' : 'text-danger-text'}>
                        {run.status}
                      </span>
                    </td>
                    <td className="text-xs">{run.jobsRetrieved}</td>
                    <td className="text-xs">{run.jobsCreated}</td>
                    <td className="text-xs">{run.jobsUpdated}</td>
                    <td className="text-xs">{run.jobsClosed}</td>
                    <td className="text-xs">{run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}