#!/usr/bin/env tsx
/**
 * Monetization initialization (one-time, idempotent).
 *
 *   npm run monetization:initialize
 *
 * What it does:
 *   1. creates the MonetizationConfig singleton if missing
 *   2. establishes ONE immutable launch timestamp
 *   3. derives the 14-day existing-user trial window from that timestamp
 *   4. gives every eligible existing user the SAME Pro trial
 *   5. skips admins and any existing admin-managed/paid plan
 *   6. never restarts a trial and never creates duplicates
 *
 * Running it repeatedly is safe: the launch timestamp is immutable, so the
 * original trial window never moves.
 *
 * Options:
 *   --dry-run          report what would change, write nothing
 *   --launch-at=ISO    set the launch timestamp (FIRST run only)
 *   --no-activate      initialise trials but leave monetization OFF
 */

import { prisma } from '../src/lib/prisma';
import { getMonetizationConfig, isMonetizationEnabled } from '../src/lib/billing/monetization';

function arg(name: string): string | null {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const dryRun = has('dry-run');
  const activate = !has('no-activate');
  const launchAtRaw = arg('launch-at');

  if (launchAtRaw && !activate) {
    console.error('--launch-at cannot be combined with --no-activate.');
    process.exit(1);
  }

  const config = await getMonetizationConfig();

  console.log('\n  teChia Jobs — monetization initialization\n');
  console.log(`  Mode              ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`  Already initialized  ${config.existingUserTrialStartedAt ? 'yes' : 'no'}`);
  console.log(`  Launch timestamp   ${config.existingUserTrialStartedAt?.toISOString() ?? '(not set)'}`);
  console.log(`  Existing-user trial ends  ${config.existingUserTrialEndsAt?.toISOString() ?? '(not set)'}`);
  console.log(`  Trial length       ${config.trialDays} days on ${config.trialPlan}`);
  console.log(`  Monetization live  ${(await isMonetizationEnabled()) ? 'yes' : 'no'}`);

  if (launchAtRaw && config.existingUserTrialStartedAt) {
    console.log('\n  WARNING: --launch-at was ignored because monetization is already initialized.');
    console.log('           The original launch timestamp is immutable. Reset the config');
    console.log('           explicitly (with an audited admin action) if you must change it.');
  }

  // Pre-flight report
  const [totalUsers, admins, withSubscription, withTrial] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.subscription.count(),
    prisma.subscriptionEvent.count({ where: { type: 'TRIAL_STARTED' } }),
  ]);

  const plans = await prisma.plan.findMany({
    select: { code: true, name: true, monthlyPrice: true, currency: true },
    orderBy: { sortOrder: 'asc' },
  });

  console.log('\n  Plan catalogue');
  for (const plan of plans) {
    const price = plan.monthlyPrice === null ? 'unpriced (Contact us)' : `${plan.monthlyPrice} ${plan.currency} minor units`;
    console.log(`    - ${plan.code.padEnd(8)} ${plan.name.padEnd(8)} ${price}`);
  }

  console.log('\n  Pre-flight');
  console.log(`    Total users          ${totalUsers}`);
  console.log(`    Admins (exempt)      ${admins}`);
  console.log(`    Existing subs        ${withSubscription}`);
  console.log(`    Trials already set   ${withTrial}`);

  if (totalUsers === 0) {
    console.log('\n  No users found. Initialization is safe but there is nothing to backfill.');
  }

  if (!config.trialPlan || !plans.some((p) => p.code === config.trialPlan)) {
    console.error(`\n  ERROR: trial plan ${config.trialPlan} is missing from the Plan catalogue.`);
    console.error('         Run `npm run prisma:migrate:deploy` to seed plans.');
    process.exit(1);
  }

  if (dryRun) {
    const eligible = totalUsers - admins;
    console.log(`\n  Would backfill approximately ${Math.max(0, eligible - withTrial)} trial(s).`);
    console.log('  Re-run without --dry-run to apply.\n');
    return;
  }

  const { initializeMonetization } = await import('../src/lib/billing/monetization');

  const result = await initializeMonetization({
    ...(launchAtRaw && !config.existingUserTrialStartedAt
      ? { launchAt: new Date(launchAtRaw) }
      : {}),
    activate,
  });

  console.log('\n  Result');
  console.log(`    Launch timestamp        ${result.launchAt.toISOString()}`);
  console.log(`    Trial window ends       ${result.trialEndsAt.toISOString()}`);
  console.log(`    Users examined          ${result.usersExamined}`);
  console.log(`    Trials created          ${result.trialsCreated}`);
  console.log(`    Skipped (already had)   ${result.trialsSkipped}`);
  console.log(`    Skipped (admins)        ${result.adminsSkipped}`);
  console.log(`    Failed                  ${result.failed}`);
  console.log(`    Monetization live       ${await isMonetizationEnabled() ? 'yes' : 'no'}`);

  if (result.failed > 0) {
    console.error('\n  WARNING: some users failed to initialize. Re-run to retry them safely.');
    process.exitCode = 1;
  }

  console.log('\n  Verify with: npm run monetization:status\n');
}

main()
  .catch((error) => {
    console.error('\n  Initialization failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });