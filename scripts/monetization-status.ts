#!/usr/bin/env tsx
/**
 * Monetization status report — read-only. Safe to run at any time.
 *
 *   npm run monetization:status
 */

import { prisma } from '../src/lib/prisma';
import {
  getMonetizationConfig,
  isMonetizationEnabled,
} from '../src/lib/billing/monetization';
import { getEmailOutboxHealth } from '../src/lib/billing/email-outbox';

async function main() {
  const config = await getMonetizationConfig();
  const enabled = await isMonetizationEnabled();

  const [totalUsers, admins, subs, requests, events, email] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.subscription.count(),
    prisma.upgradeRequest.count(),
    prisma.subscriptionEvent.count(),
    getEmailOutboxHealth(),
  ]);

  const byStatus = await prisma.subscription.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  const openRequests = await prisma.upgradeRequest.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  console.log('\n  teChia Jobs — monetization status\n');
  console.log(`  Monetization live        ${enabled ? 'YES' : 'no'}`);
  console.log(`  Launch timestamp         ${config.enabledAt?.toISOString() ?? '(not activated)'}`);
  console.log(`  Existing-user trial      ${config.existingUserTrialStartedAt?.toISOString() ?? '(not set)'} → ${config.existingUserTrialEndsAt?.toISOString() ?? '(not set)'}`);
  console.log(`  Trial configuration      ${config.trialDays} days on ${config.trialPlan}`);
  console.log(`  Initialized at           ${config.initializedAt?.toISOString() ?? '(never)'}`);

  console.log('\n  Accounts');
  console.log(`    Total users            ${totalUsers}`);
  console.log(`    Admins                 ${admins}${admins === 0 ? '   <-- NO ADMIN: admin workflows are unmanageable' : ''}`);
  console.log(`    Subscriptions          ${subs}`);
  console.log(`    Subscription events    ${events}`);

  console.log('\n  Subscriptions by status');
  if (byStatus.length === 0) console.log('    (none)');
  for (const row of byStatus) {
    console.log(`    ${row.status.padEnd(12)} ${row._count._all}`);
  }

  console.log('\n  Upgrade requests by status');
  if (openRequests.length === 0) console.log('    (none)');
  for (const row of openRequests) {
    console.log(`    ${row.status.padEnd(12)} ${row._count._all}`);
  }

  console.log('\n  Email outbox');
  console.log(`    Configured             ${email.configured ? 'yes' : 'NO  <-- transactional email cannot send'}`);
  console.log(`    Pending                ${email.pending}`);
  console.log(`    Processing             ${email.processing}`);
  console.log(`    Failed                 ${email.failed}`);
  console.log(`    Sent                   ${email.sent}`);
  console.log('');

  if (admins === 0) {
    console.log('  Run `npm run admin:bootstrap -- you@yourdomain.com` before activating.\n');
  }
}

main()
  .catch((error) => {
    console.error('Failed to read monetization status:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });