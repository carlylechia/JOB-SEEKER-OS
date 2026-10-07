import Link from 'next/link';
import {
  FEATURE_ENTITLEMENTS,
  FEATURE_KEYS,
  type FeatureKey,
} from '@/lib/billing/plans';
import { requiredPlanFor } from '@/lib/billing/subscriptions';

/**
 * Explains a gated capability without hiding it.
 *
 * Copy is honest: it names the unlocking plan, explains why the capability is
 * useful, and points at the upgrade path. It never claims payment happens
 * in-app.
 */
export function PlanRequiredCard({
  feature,
  currentPlan,
  isTrialing,
}: {
  feature: FeatureKey;
  currentPlan: string;
  isTrialing?: boolean;
}) {
  const meta = FEATURE_ENTITLEMENTS[feature];
  const required = requiredPlanFor(feature);
  const requiredLabel = required.charAt(0) + required.slice(1).toLowerCase();

  if (meta.released === false) {
    return (
      <div className="card-pad">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-silverlight text-sm font-semibold text-slate"
          >
            {requiredLabel.charAt(0)}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{meta.label}</h3>
            <p className="muted mt-1">{meta.description}</p>
            <p className="mt-2 text-xs font-medium text-[#6B5410]">
              Coming soon with {requiredLabel}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-pad">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-semibold text-[#6B5410]"
        >
          {requiredLabel.charAt(0)}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{meta.label}</h3>
          <p className="muted mt-1">{meta.description}</p>
          <p className="mt-2 text-xs font-medium text-[#6B5410]">
            {isTrialing
              ? `Included in your Pro trial.`
              : `Available with ${requiredLabel}.`}
          </p>
          <Link href="/settings/billing" className="btn-secondary mt-3 text-xs">
            {isTrialing ? 'View my plan' : `Request ${requiredLabel}`}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Accessible feature comparison table.
 *
 * Uses a real <table> with scoped headers so screen readers announce the row
 * and column context. Inclusion is communicated with text, not icons alone.
 */
export function FeatureComparisonTable({ currentPlan }: { currentPlan: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">
          Feature availability by plan
        </caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Free</th>
            <th scope="col">Pro</th>
            <th scope="col">Premium</th>
          </tr>
        </thead>
        <tbody>
          {FEATURE_KEYS.map((key) => {
            const meta = FEATURE_ENTITLEMENTS[key];
            const label = (
              <span>
                {meta.label}
                {!meta.released ? (
                  <span className="ml-2 text-xs font-normal text-muted">(coming soon)</span>
                ) : null}
              </span>
            );

            return (
              <tr key={key}>
                <th scope="row" className="px-4 py-3 text-left text-sm font-normal text-ink">
                  {label}
                </th>
                {(['FREE', 'PRO', 'PREMIUM'] as const).map((plan) => {
                  const included = meta.plans.includes(plan);
                  const isCurrent = plan === currentPlan;
                  return (
                    <td key={plan} className={isCurrent ? 'bg-gold/[0.07]' : undefined}>
                      <span
                        className={
                          included
                            ? 'text-xs font-semibold text-[#136B45]'
                            : 'text-xs text-muted'
                        }
                      >
                        {included ? 'Included' : 'Not included'}
                        {isCurrent ? (
                          <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-[#6B5410]">
                            Current
                          </span>
                        ) : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}