import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/shared/page-header';
import { requireUser } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { getUserBillingSummary } from '@/lib/billing/monetization';
import { PlanBadge, StatusBadge } from '@/components/billing/plan-badge';
import { TrialCountdown } from '@/components/billing/trial-countdown';
import { FeatureComparisonTable } from '@/components/billing/plan-required-card';
import { UpgradeRequestForm } from '@/components/billing/upgrade-request-form';
import { PLAN_CODES, PLAN_MARKETING, formatPlanPrice, getPlanLabel } from '@/lib/billing/plans';

// Private, per-user billing data. Never cached, never indexed.
export const metadata: Metadata = {
  title: 'Plan & Billing — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const user = await requireUser();

  const [summary, plans] = await Promise.all([
    getUserBillingSummary(user.id),
    prisma.plan.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, description: true, monthlyPrice: true, currency: true },
    }),
  ]);

  if (summary.isAdmin) {
    // Admins have unrestricted access; a billing page would be misleading.
    redirect('/dashboard');
  }

  const planLabel = getPlanLabel(summary.plan, summary.isTrialing);
  const canRequestUpgrade = summary.plan !== 'PREMIUM' && !summary.openRequest;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan & Billing"
        subtitle="Manage your plan, review what each tier includes, and request an upgrade."
      />

      {/* Current plan */}
      <section aria-labelledby="current-plan-heading" className="card-pad">
        <h2 id="current-plan-heading" className="text-sm font-semibold text-muted">
          Current plan
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <PlanBadge plan={summary.plan} isTrialing={summary.isTrialing} size="md" />
          <StatusBadge status={summary.status} />
        </div>

        {summary.trialEndsAt ? (
          <div className="mt-4">
            <TrialCountdown
              trialEndsAt={summary.trialEndsAt.toISOString()}
              isTrialing={summary.isTrialing}
              trialExpired={summary.trialExpired}
            />
          </div>
        ) : null}

        {summary.endsAt ? (
          <p className="mt-3 text-sm text-muted">
            Plan access expires on{' '}
            <strong className="text-ink">
              {summary.endsAt.toLocaleDateString(undefined, { dateStyle: 'long' })}
            </strong>
            .
          </p>
        ) : null}

        {!summary.isTrialing && summary.status === 'EXPIRED' ? (
          <p className="mt-3 text-sm text-muted">
            Your account is active on the Free plan. Everything you have created is still here.
          </p>
        ) : null}
      </section>

      {/* Existing request */}
      {summary.openRequest ? (
        <section
          aria-labelledby="request-status-heading"
          className="card-pad border-gold/40 bg-gold/[0.06]"
        >
          <h2 id="request-status-heading" className="text-sm font-semibold text-ink">
            Upgrade request pending
          </h2>
          <p className="muted mt-2">
            You requested the{' '}
            <strong className="text-ink">
              {getPlanLabel(summary.openRequest.requestedPlan, false)}
            </strong>{' '}
            plan on{' '}
            {summary.openRequest.createdAt.toLocaleDateString(undefined, { dateStyle: 'medium' })}.
            A member of the team will contact you to finalise the details.
          </p>
          <p className="mt-2 text-xs text-muted">
            You can submit a new request once this one has been resolved.
          </p>
        </section>
      ) : null}

      {summary.latestRequest && !summary.openRequest &&
      ['APPROVED', 'REJECTED', 'CANCELLED'].includes(summary.latestRequest.status) ? (
        <section aria-labelledby="request-history-heading" className="card-pad">
          <h2 id="request-history-heading" className="text-sm font-semibold text-ink">
            Your last upgrade request
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={summary.latestRequest.status} />
            <span className="muted">
              {getPlanLabel(summary.latestRequest.requestedPlan, false)} ·{' '}
              {summary.latestRequest.createdAt.toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </span>
          </div>
        </section>
      ) : null}

      {/* Plans */}
      <section aria-labelledby="plans-heading" className="space-y-4">
        <h2 id="plans-heading" className="title">
          Available plans
        </h2>

        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.code === summary.plan;
            const marketing = PLAN_MARKETING[plan.code as (typeof PLAN_CODES)[number]];
            const price = formatPlanPrice(plan.monthlyPrice, plan.currency);

            return (
              <article
                key={plan.code}
                aria-current={isCurrent ? 'true' : undefined}
                className={`card-pad flex flex-col ${
                  isCurrent ? 'border-gold ring-1 ring-gold/30' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-ink">{plan.name}</h3>
                  {isCurrent ? <PlanBadge plan={plan.code} isTrialing={summary.isTrialing} /> : null}
                </div>

                <p className="mt-2 text-lg font-semibold text-ink">{price.label}</p>
                {!price.isPriced ? (
                  <p className="mt-1 text-xs text-muted">
                    Pricing is confirmed during the upgrade conversation.
                  </p>
                ) : null}

                <p className="muted mt-2">{plan.description}</p>

                <ul className="mt-4 flex-1 space-y-2">
                  {marketing.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-ink">
                      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4">
                  {isCurrent ? (
                    <p className="text-xs font-medium text-muted">This is your current plan</p>
                  ) : plan.code === 'FREE' ? (
                    <p className="text-xs text-muted">Included with every account</p>
                  ) : summary.openRequest ? (
                    <p className="text-xs text-muted">Upgrade request pending</p>
                  ) : (
                    <a href="#request" className="btn-primary text-xs">
                      Request {plan.name}
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Request form */}
      {canRequestUpgrade ? (
        <section id="request" aria-labelledby="request-heading" className="space-y-3">
          <h2 id="request-heading" className="title">
            Request an upgrade
          </h2>
          <p className="muted max-w-2xl">
            Submitting a request does not charge you. A teChia Jobs administrator will contact you
            to finalise your plan, and your account is upgraded once the arrangement is confirmed.
          </p>
          <UpgradeRequestForm
            defaultEmail={user.email}
            currentPlan={summary.plan}
          />
        </section>
      ) : null}

      {/* Feature comparison */}
      <section aria-labelledby="comparison-heading" className="space-y-3">
        <h2 id="comparison-heading" className="title">
          What&apos;s included
        </h2>
        <FeatureComparisonTable currentPlan={summary.plan} />
      </section>
    </div>
  );
}