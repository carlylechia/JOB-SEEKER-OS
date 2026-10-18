import { FEATURE_ENTITLEMENTS, type FeatureKey } from '@/lib/billing/plans';
import type { AiCreditsPayload } from '@/lib/billing/ai-credits';

/**
 * The AI allowance, as a balance.
 *
 * The point of this component is that the number moves. An earlier version
 * rendered `PLAN_LIMITS[*].aiCredits` — the plan's ceiling — under a label that
 * said "credits left", so it read as a balance while behaving as an
 * advertising figure.
 *
 * Renders after the client has fetched state, never during SSR, so formatting
 * the reset date in the browser's locale cannot disagree with server output.
 */

function formatReset(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

function headline(credits: AiCreditsPayload): string {
  if (credits.remaining === null) return 'Unlimited AI runs';
  if (credits.remaining === 0) return 'No AI credits left this month';
  return `${credits.remaining} AI credit${credits.remaining === 1 ? '' : 's'} left`;
}

function breakdown(credits: AiCreditsPayload): string {
  return credits.byFeature
    .filter((entry) => entry.used > 0)
    .map(
      (entry) =>
        `${FEATURE_ENTITLEMENTS[entry.feature as FeatureKey]?.label ?? entry.feature} ×${entry.used}`,
    )
    .join(' · ');
}

export function AiCreditsMeter({ credits }: { credits: AiCreditsPayload }) {
  const spent = breakdown(credits);
  const reset = credits.remaining === null ? null : formatReset(credits.resetsAt);

  return (
    <div className="text-xs text-muted">
      <span>{headline(credits)}</span>
      {reset ? <span> · resets {reset}</span> : null}
      {spent ? <span className="block">Used this month: {spent}</span> : null}
    </div>
  );
}