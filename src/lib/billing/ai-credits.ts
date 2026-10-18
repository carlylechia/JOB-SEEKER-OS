/**
 * The AI allowance as it goes over the wire.
 *
 * Routes previously reported `aiCreditsRemaining: entitlements.limits.aiCredits`
 * — the plan's CEILING, not the user's balance. A Free user on their last
 * credit was told "25 AI credits left", which is the worst possible thing to say
 * to someone about to be declined, and it did not move as they used the product.
 *
 * This returns what is actually left, plus the reset date and a breakdown of
 * where the rest of the allowance went, so the interface can show a balance
 * instead of an advertising figure.
 */

import { getPoolUsageSummary } from './usage';
import type { FeatureKey } from './plans';

export type AiCreditsPayload = {
  /** Operations drawn from the shared AI allowance this period. */
  used: number;
  /** The plan's allowance, or `null` when unlimited. */
  limit: number | null;
  /** Allowance still available, or `null` when unlimited. */
  remaining: number | null;
  /** When the allowance resets (ISO 8601). */
  resetsAt: string;
  /** Largest consumer first; sums to `used`. */
  byFeature: Array<{ feature: FeatureKey; used: number }>;
};

/**
 * Current state of the user's shared AI allowance.
 *
 * `limit` is the plan ceiling from `entitlements.limits.aiCredits`; everything
 * else is measured. Pass `null` for an unlimited plan.
 */
export async function getAiCreditsPayload(
  userId: string,
  limit: number | null,
): Promise<AiCreditsPayload> {
  const summary = await getPoolUsageSummary(userId, 'AI', limit);

  return {
    used: summary.used,
    limit: summary.limit,
    remaining: summary.remaining,
    resetsAt: summary.periodEnd.toISOString(),
    byFeature: summary.byFeature,
  };
}