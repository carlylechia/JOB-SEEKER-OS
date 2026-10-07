import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { getEffectiveSubscription } from '@/lib/billing/subscriptions';
import { getUserUsageBreakdown } from '@/lib/billing/usage';
import { StatusBadge, PlanBadge } from '@/components/billing/plan-badge';
import { RequestActions } from '@/components/admin/request-actions';
import { buildMailtoUrl, buildWhatsappUrl, whatsappPrefill } from '@/lib/billing/upgrade-requests';

export const dynamic = 'force-dynamic';

function fmt(date: Date | null | undefined) {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AdminUpgradeRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const request = await prisma.upgradeRequest.findUnique({
    where: { id },
    select: {
      id: true,
      requestedPlan: true,
      currentPlanSnapshot: true,
      currentStatusSnapshot: true,
      contactMethod: true,
      contactEmail: true,
      whatsappNumber: true,
      message: true,
      status: true,
      adminNote: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          emailVerified: true,
        },
      },
      resolvedByAdmin: { select: { email: true } },
    },
  });

  if (!request) notFound();

  const [effective, usage, jobCount, timeline] = await Promise.all([
    getEffectiveSubscription(request.user.id),
    getUserUsageBreakdown(request.user.id),
    prisma.jobLead.count({ where: { userId: request.user.id, deletedAt: null } }),
    // Real events only — never fabricated timestamps.
    prisma.subscriptionEvent.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, type: true, createdAt: true, newPlanCode: true, actorAdmin: { select: { email: true } } },
    }),
  ]);

  const whatsappUrl = buildWhatsappUrl(
    request.whatsappNumber,
    whatsappPrefill(request.user.name, request.requestedPlan),
  );
  const mailtoUrl = buildMailtoUrl(
    request.contactEmail,
    `Your teChia Jobs ${request.requestedPlan} upgrade request`,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="title">Upgrade request</h1>
          <p className="muted mt-1">
            {request.user.name ?? '—'} · submitted {fmt(request.createdAt)}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* User */}
        <section aria-labelledby="user-heading" className="card-pad">
          <h2 id="user-heading" className="text-sm font-semibold text-ink">
            User
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Name</dt>
              <dd className="text-ink">{request.user.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Email</dt>
              <dd className="break-all text-ink">{request.user.email}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Current plan</dt>
              <dd className="text-ink">
                <PlanBadge plan={effective.plan} isTrialing={effective.isTrialing} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Status</dt>
              <dd className="text-ink">{effective.status}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Trial ends</dt>
              <dd className="text-ink">{fmt(effective.trialEndsAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Account created</dt>
              <dd className="text-ink">{fmt(request.user.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Jobs tracked</dt>
              <dd className="text-ink">{jobCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Usage this period</dt>
              <dd className="text-ink">
                {usage.length === 0
                  ? 'None'
                  : usage.map((u) => `${u.feature.replace(/_/g, ' ')}: ${u.units}`).join(', ')}
              </dd>
            </div>
          </dl>
          <Link
            href={`/admin/users/${request.user.id}`}
            className="btn-secondary mt-4 text-xs"
          >
            Open full user record
          </Link>
        </section>

        {/* Request */}
        <section aria-labelledby="request-heading" className="card-pad">
          <h2 id="request-heading" className="text-sm font-semibold text-ink">
            Request
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Desired plan</dt>
              <dd className="text-ink">
                <PlanBadge plan={request.requestedPlan} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Plan at request time</dt>
              <dd className="text-ink">
                {request.currentPlanSnapshot ?? '—'}
                {request.currentStatusSnapshot ? ` (${request.currentStatusSnapshot})` : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Contact method</dt>
              <dd className="text-ink">
                {request.contactMethod === 'EMAIL' ? 'Email' : 'WhatsApp'}
              </dd>
            </div>
            {request.contactEmail ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Email</dt>
                <dd className="break-all text-ink">{request.contactEmail}</dd>
              </div>
            ) : null}
            {request.whatsappNumber ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">WhatsApp</dt>
                <dd className="text-ink">{request.whatsappNumber}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Submitted</dt>
              <dd className="text-ink">{fmt(request.createdAt)}</dd>
            </div>
          </dl>

          {/* User message — visually separated from internal notes */}
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">User message</p>
            <p className="mt-1.5 rounded-xl bg-black/[0.03] p-3 text-sm text-ink">
              {request.message || <span className="text-muted">No message provided.</span>}
            </p>
          </div>

          {request.adminNote ? (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Internal admin note
              </p>
              <p className="mt-1.5 rounded-xl border border-line bg-silverlight/50 p-3 text-sm text-ink">
                {request.adminNote}
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {mailtoUrl ? (
              <a href={mailtoUrl} className="btn-secondary text-xs">
                Open email
              </a>
            ) : null}
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-xs"
              >
                Open WhatsApp
              </a>
            ) : null}
            <Link href={`/admin/users/${request.user.id}`} className="btn-secondary text-xs">
              Update plan
            </Link>
          </div>
        </section>
      </div>

      {/* Actions */}
      <RequestActions
        requestId={request.id}
        status={request.status}
        requestedPlan={request.requestedPlan}
        userName={request.user.name ?? request.user.email}
      />

      {/* Timeline — real events only */}
      <section aria-labelledby="timeline-heading" className="space-y-3">
        <h2 id="timeline-heading" className="title">
          Timeline
        </h2>
        <ol className="card-pad space-y-3">
          <li className="flex gap-3 text-sm">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" />
            <span className="text-ink">
              Request submitted
              <span className="block text-xs text-muted">{fmt(request.createdAt)}</span>
            </span>
          </li>
          {request.resolvedAt ? (
            <li className="flex gap-3 text-sm">
              <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-silver" />
              <span className="text-ink">
                Request {request.status.toLowerCase()}
                <span className="block text-xs text-muted">
                  {fmt(request.resolvedAt)}
                  {request.resolvedByAdmin ? ` by ${request.resolvedByAdmin.email}` : ''}
                </span>
              </span>
            </li>
          ) : null}
          {timeline.slice(-8).map((event) => (
            <li key={event.id} className="flex gap-3 text-sm">
              <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line" />
              <span className="text-ink">
                {event.type.replace(/_/g, ' ').toLowerCase()}
                {event.newPlanCode ? ` → ${event.newPlanCode}` : ''}
                <span className="block text-xs text-muted">
                  {fmt(event.createdAt)}
                  {event.actorAdmin ? ` by ${event.actorAdmin.email}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}