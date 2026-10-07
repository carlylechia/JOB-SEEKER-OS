import { requireAdmin } from '@/lib/authz';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getEffectiveSubscription } from '@/lib/billing/subscriptions';
import { getUserUsageBreakdown } from '@/lib/billing/usage';
import { PlanBadge, StatusBadge } from '@/components/billing/plan-badge';
import { PlanChangePanel } from '@/components/admin/plan-change-panel';
import { buildMailtoUrl, buildWhatsappUrl, whatsappPrefill } from '@/lib/billing/upgrade-requests';

export const dynamic = 'force-dynamic';

function fmt(date: Date | null | undefined) {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      createdAt: true,
      lastActiveDate: true,
      streakCount: true,
    },
  });

  if (!user) notFound();

  const [effective, subscription, usage, requests, events, jobCount] = await Promise.all([
    getEffectiveSubscription(id),
    prisma.subscription.findUnique({
      where: { userId: id },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        trialStartsAt: true,
        trialEndsAt: true,
        source: true,
        adminNote: true,
        plan: { select: { code: true, name: true } },
      },
    }),
    getUserUsageBreakdown(id),
    prisma.upgradeRequest.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.subscriptionEvent.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        type: true,
        previousPlanCode: true,
        newPlanCode: true,
        previousStatus: true,
        newStatus: true,
        reason: true,
        createdAt: true,
        actorAdmin: { select: { email: true } },
      },
    }),
    // Count only — never the user's job content.
    prisma.jobLead.count({ where: { userId: id, deletedAt: null } }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="title">{user.name ?? user.email}</h1>
        <p className="muted mt-1">{user.email}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Account */}
        <section aria-labelledby="account-heading" className="card-pad">
          <h2 id="account-heading" className="text-sm font-semibold text-ink">
            Account
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Email verified</dt>
              <dd className="text-ink">{user.emailVerified ? 'Yes' : 'No'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Role</dt>
              <dd className="text-ink">{user.role}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Joined</dt>
              <dd className="text-ink">{fmt(user.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Last active</dt>
              <dd className="text-ink">{fmt(user.lastActiveDate)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Jobs tracked</dt>
              <dd className="text-ink">{jobCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Streak</dt>
              <dd className="text-ink">{user.streakCount}</dd>
            </div>
          </dl>
        </section>

        {/* Plan */}
        <section aria-labelledby="plan-heading" className="card-pad">
          <h2 id="plan-heading" className="text-sm font-semibold text-ink">
            Plan & access
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PlanBadge plan={effective.plan} isTrialing={effective.isTrialing} size="md" />
            <StatusBadge status={effective.status} />
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Starts</dt>
              <dd className="text-ink">{fmt(subscription?.startsAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Expires</dt>
              <dd className="text-ink">
                {subscription?.endsAt ? fmt(subscription.endsAt) : 'No expiry'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Trial start</dt>
              <dd className="text-ink">{fmt(subscription?.trialStartsAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Trial end</dt>
              <dd className="text-ink">{fmt(subscription?.trialEndsAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Source</dt>
              <dd className="text-ink">{subscription?.source ?? '—'}</dd>
            </div>
          </dl>
        </section>
      </div>

      {/* Usage */}
      <section aria-labelledby="usage-heading" className="card-pad">
        <h2 id="usage-heading" className="text-sm font-semibold text-ink">
          Usage this period
        </h2>
        {usage.length === 0 ? (
          <p className="muted mt-2">No metered usage recorded in the current period.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {usage.map((item) => (
              <li key={item.feature} className="flex justify-between text-sm">
                <span className="text-ink">{item.feature.replace(/_/g, ' ').toLowerCase()}</span>
                <span className="text-muted">{item.units} units</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Plan change */}
      <PlanChangePanel
        userId={user.id}
        userName={user.name ?? user.email}
        currentPlan={effective.plan}
        currentStatus={subscription?.status ?? 'NONE'}
        currentTrialEndsAt={subscription?.trialEndsAt?.toISOString() ?? null}
      />

      {/* Upgrade requests */}
      <section aria-labelledby="requests-heading" className="space-y-3">
        <h2 id="requests-heading" className="title">
          Upgrade requests
        </h2>
        {requests.length === 0 ? (
          <p className="muted">No upgrade requests from this user.</p>
        ) : (
          <ul className="space-y-3">
            {requests.map((request) => (
              <li key={request.id} className="card-pad">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={request.status} />
                  <span className="text-sm font-medium text-ink">
                    {request.requestedPlan.charAt(0) + request.requestedPlan.slice(1).toLowerCase()}
                  </span>
                  <span className="text-xs text-muted">{fmt(request.createdAt)}</span>
                </div>
                {request.message ? (
                  <div className="mt-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      User message
                    </p>
                    <p className="mt-1 text-sm text-ink">{request.message}</p>
                  </div>
                ) : null}
                {request.adminNote ? (
                  <div className="mt-3 rounded-xl bg-black/[0.03] p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      Internal admin note
                    </p>
                    <p className="mt-1 text-sm text-ink">{request.adminNote}</p>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
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
                      Email user
                    </a>
                  ) : null}
                  {buildWhatsappUrl(request.whatsappNumber) ? (
                    <a
                      href={
                        buildWhatsappUrl(
                          request.whatsappNumber,
                          whatsappPrefill(user.name, request.requestedPlan),
                        ) ?? '#'
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary px-3 py-1 text-xs"
                    >
                      WhatsApp user
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Subscription history */}
      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="title">
          Subscription history
        </h2>
        {events.length === 0 ? (
          <p className="muted">No history recorded.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Subscription change history</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Event</th>
                  <th scope="col">Plan change</th>
                  <th scope="col">Reason</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap text-xs">{fmt(event.createdAt)}</td>
                    <td className="text-xs">{event.type.replace(/_/g, ' ')}</td>
                    <td className="text-xs">
                      {event.previousPlanCode ?? '—'} → {event.newPlanCode ?? '—'}
                    </td>
                    <td className="max-w-xs truncate text-xs">{event.reason ?? '—'}</td>
                    <td className="text-xs">{event.actorAdmin?.email ?? 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {subscription?.adminNote ? (
        <section className="card-pad">
          <h2 className="text-sm font-semibold text-ink">Internal admin note</h2>
          <p className="mt-2 text-sm text-ink">{subscription.adminNote}</p>
        </section>
      ) : null}
    </div>
  );
}