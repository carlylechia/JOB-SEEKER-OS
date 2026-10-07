import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { getEmailOutboxHealth } from '@/lib/billing/email-outbox';
import { addDays, now } from '@/lib/billing/clock';
import { PlanBadge, StatusBadge } from '@/components/billing/plan-badge';

export const metadata: Metadata = {
  title: 'Admin — teChia Jobs',
  robots: { index: false, follow: false },
};

// Admin data is private and changes constantly — never cached.
export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  // Server-side authorization. A normal user is redirected away here.
  await requireAdmin();

  const at = now();
  const trialCutoff = addDays(at, 7);

  const [
    totalUsers,
    totalAdmins,
    freeUsers,
    trialUsers,
    paidUsers,
    pendingRequests,
    trialsEndingSoon,
    recentEvents,
    email,
    monetization,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', plan: { code: 'FREE' } } }),
    prisma.subscription.count({ where: { status: 'TRIALING', trialEndsAt: { gt: at } } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', plan: { code: { in: ['PRO', 'PREMIUM'] } } } }),
    prisma.upgradeRequest.count({ where: { status: { in: ['PENDING', 'CONTACTED'] } } }),
    prisma.subscription.count({ where: { status: 'TRIALING', trialEndsAt: { gt: at, lte: trialCutoff } } }),
    prisma.subscriptionEvent.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        previousPlanCode: true,
        newPlanCode: true,
        reason: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
        actorAdmin: { select: { email: true } },
      },
    }),
    getEmailOutboxHealth(),
    prisma.monetizationConfig.findUnique({
      where: { id: 'global' },
      select: {
        enabledAt: true,
        existingUserTrialStartedAt: true,
        existingUserTrialEndsAt: true,
        initializedAt: true,
      },
    }),
  ]);

  const cards = [
    { label: 'Total users', value: totalUsers, href: '/admin/users' },
    { label: 'Trials', value: trialUsers, href: '/admin/users?access=trial' },
    { label: 'Paid', value: paidUsers, href: '/admin/users?access=paid' },
    { label: 'Free', value: freeUsers, href: '/admin/users?access=free' },
    {
      label: 'Pending requests',
      value: pendingRequests,
      href: '/admin/upgrade-requests?status=PENDING',
      highlight: pendingRequests > 0,
    },
    { label: 'Trials ending soon', value: trialsEndingSoon, href: '/admin/users?access=trial' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="title">Admin overview</h1>
        <p className="muted mt-1">teChia Jobs operations</p>
      </div>

      <nav aria-label="Admin sections" className="flex flex-wrap gap-2">
        {[
          { href: '/admin', label: 'Overview' },
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

      {/* System warnings */}
      {totalAdmins === 0 ? (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/[0.06] p-4">
          <p className="text-sm font-semibold text-[#9B2C2C]">No administrators exist</p>
          <p className="mt-1 text-sm text-ink">
            Upgrade requests cannot be managed until at least one account is promoted. Run{' '}
            <code className="rounded bg-black/5 px-1 py-0.5 text-xs">
              npm run admin:bootstrap -- you@yourdomain.com
            </code>
            .
          </p>
        </div>
      ) : null}

      {!email.configured ? (
        <div role="alert" className="rounded-2xl border border-warn/40 bg-warn/[0.06] p-4">
          <p className="text-sm font-semibold text-ink">Transactional email is not configured</p>
          <p className="mt-1 text-sm text-ink">
            <code className="rounded bg-black/5 px-1 py-0.5 text-xs">RESEND_API_KEY</code> is not
            set, so verification, password reset, and billing emails cannot be delivered.
          </p>
        </div>
      ) : null}

      {/* Metrics */}
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">
          Key metrics
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {cards.map((card) => (
            <Link key={card.label} href={card.href} className="card-pad block transition hover:border-gold/50">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{card.label}</p>
              <p
                className={`mt-1.5 text-2xl font-semibold ${
                  card.highlight ? 'text-[#6B5410]' : 'text-ink'
                }`}
              >
                {card.value}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Monetization state */}
      <section aria-labelledby="monetization-heading" className="card-pad">
        <h2 id="monetization-heading" className="text-sm font-semibold text-ink">
          Monetization status
        </h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Live</dt>
            <dd className="text-ink">
              {monetization?.enabledAt ? 'Yes' : 'No — trials will not start'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Launch</dt>
            <dd className="text-ink">
              {monetization?.enabledAt
                ? new Date(monetization.enabledAt).toLocaleString()
                : 'Not activated'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Existing-user trial window</dt>
            <dd className="text-ink">
              {monetization?.existingUserTrialStartedAt
                ? `${new Date(monetization.existingUserTrialStartedAt).toLocaleDateString()} → ${new Date(
                    monetization.existingUserTrialEndsAt!,
                  ).toLocaleDateString()}`
                : 'Not initialized'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Initialized</dt>
            <dd className="text-ink">
              {monetization?.initializedAt
                ? new Date(monetization.initializedAt).toLocaleString()
                : 'Never'}
            </dd>
          </div>
        </dl>
      </section>

      {/* Email health */}
      <section aria-labelledby="email-heading" className="card-pad">
        <h2 id="email-heading" className="text-sm font-semibold text-ink">
          Email delivery
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
      </section>

      {/* Recent activity */}
      <section aria-labelledby="activity-heading" className="space-y-3">
        <h2 id="activity-heading" className="title">
          Recent plan changes
        </h2>
        {recentEvents.length === 0 ? (
          <p className="muted">No plan changes recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Recent subscription changes</caption>
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Change</th>
                  <th scope="col">Reason</th>
                  <th scope="col">By</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Link
                        href={`/admin/users/${event.user.id}`}
                        className="font-medium underline underline-offset-2"
                      >
                        {event.user.name ?? event.user.email}
                      </Link>
                    </td>
                    <td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {event.previousPlanCode ? <PlanBadge plan={event.previousPlanCode} /> : null}
                        {event.previousPlanCode ? (
                          <span aria-hidden="true" className="text-muted">
                            →
                          </span>
                        ) : null}
                        {event.newPlanCode ? <PlanBadge plan={event.newPlanCode} /> : null}
                        <StatusBadge status={event.type.replace(/_/g, ' ')} />
                      </span>
                    </td>
                    <td className="max-w-xs truncate">{event.reason ?? '—'}</td>
                    <td>{event.actorAdmin?.email ?? 'System'}</td>
                    <td className="whitespace-nowrap">{new Date(event.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}