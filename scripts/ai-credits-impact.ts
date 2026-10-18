#!/usr/bin/env tsx
/**
 * AI-credits impact report — READ-ONLY. Writes nothing; safe to run at any time.
 *
 *   npm run ai-credits:impact
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The AI allowance was summed per `featureKey` while being described, in the
 * plan copy and in `PLAN_LIMITS`, as a single monthly figure. Those are not the
 * same thing. A Free user with an allowance of 25 could run 25 resume analyses
 * AND 25 job analyses AND 25 resume optimisations in one month — up to three
 * times what they were sold, growing again with every metered feature shipped.
 *
 * The accounting layer now draws from one shared pool per user. That is a
 * reduction in what some users can do, so it needs to be a decision rather than
 * a surprise.
 *
 * This reports exactly who feels it and by how much:
 *
 *   • REDUCED  — used more than the pool allows. These users' later requests
 *                will now start failing. This is the list to contact.
 *   • UNCHANGED — within the allowance. Nothing about their behaviour changes.
 *
 * It reports COHORT SIZES, never per-user rows, so the output can be pasted
 * into a ticket or an incident note without carrying customer data with it. To
 * identify an individual, query them directly as an admin.
 *
 * It reports the CURRENT period only, since only the current period can be
 * affected: a past month's overage is history and is not re-billed.
 */

import { prisma } from '../src/lib/prisma';
import { startOfUtcPeriod, endOfUtcPeriod, now } from '../src/lib/billing/clock';
import { FEATURE_ENTITLEMENTS, PLAN_LIMITS, type FeatureKey, type PlanCode, type UsagePool } from '../src/lib/billing/plans';
import { featuresInPool } from '../src/lib/billing/usage';
import { buildEntitlements, getEffectiveSubscription } from '../src/lib/billing/subscriptions';

/** Rows in the pool for the current period, totalled per user. */
async function poolTotals(pool: UsagePool, at: Date) {
  const periodStart = startOfUtcPeriod(at);
  const grouped = await prisma.usageRecord.groupBy({
    by: ['userId'],
    where: {
      periodStart,
      featureKey: { in: featuresInPool(pool) as FeatureKey[] },
    },
    _sum: { units: true },
  });
  return new Map(grouped.map((row) => [row.userId, row._sum.units ?? 0]));
}

/**
 * The allowance each user is actually subject to, from the real resolver.
 *
 * Deliberately NOT re-derived from `User` + `Subscription` directly: trial
 * expiry, admin exemption and cancelled-but-not-yet-ended subscriptions all
 * live in `getEffectiveSubscription`, and a report that guessed at them would
 * eventually disagree with production — which is the one thing a report about a
 * billing change must not do.
 *
 * Costs two queries per user, but only for users who consumed something this
 * period, so the work is bounded by actual usage rather than the user table.
 */
async function allowancesFor(userIds: Iterable<string>) {
  const limits = new Map<string, { plan: string; aiCredits: number | null }>();

  for (const userId of userIds) {
    const entitlements = buildEntitlements(await getEffectiveSubscription(userId));
    limits.set(userId, {
      plan: entitlements.plan,
      aiCredits: entitlements.limits.aiCredits,
    });
  }

  return limits;
}

async function main() {
  const at = now();
  const pool: UsagePool = 'AI';
  const metered = featuresInPool(pool);

  console.log('\n  teChia Jobs — AI credits impact report\n');
  console.log(`  Period      ${startOfUtcPeriod(at).toISOString()} → ${endOfUtcPeriod(at).toISOString()}`);
  console.log(`  Pool        ${pool} (${metered.map((f) => FEATURE_ENTITLEMENTS[f].label).join(', ')})`);
  console.log('  Mode        read-only\n');

  const totals = await poolTotals(pool, at);

  if (totals.size === 0) {
    console.log('  No AI usage recorded this period. Nobody is affected by this change.\n');
    return;
  }

  const allowances = await allowancesFor(totals.keys());

  const reducedByPlan = new Map<string, number>();
  let affected = 0;
  let unlimited = 0;

  for (const [userId, used] of totals) {
    const entry = allowances.get(userId);
    if (!entry || entry.aiCredits === null) {
      unlimited += 1;
      continue;
    }
    if (used > entry.aiCredits) {
      affected += 1;
      reducedByPlan.set(entry.plan, (reducedByPlan.get(entry.plan) ?? 0) + 1);
    }
  }

  const label = (text: string) => text.padEnd(42);
  console.log(`  ${label('Users with any AI usage this period')} ${totals.size}`);
  console.log(`  ${label('On an unlimited plan (unaffected)')} ${unlimited}`);
  console.log(`  ${label('Over the shared allowance')} ${affected}`);

  if (affected === 0) {
    console.log('\n  No user would be affected by this change.\n');
    return;
  }

  console.log('\n  Affected, by plan:');
  for (const [plan, count] of [...reducedByPlan.entries()].sort()) {
    const allowance = PLAN_LIMITS[plan as PlanCode].aiCredits;
    console.log(
      `    ${plan.padEnd(10)}${String(count).padStart(5)} user${count === 1 ? '' : 's'} over an allowance of ${allowance}`,
    );
  }

  console.log(
    '\n  These users keep their remaining allowance but will be declined once it\n' +
      '  runs out. Consider notifying them before this ships.\n',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());