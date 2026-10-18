#!/usr/bin/env tsx
/**
 * Billing + email maintenance worker.
 *
 * Runs the same routine as the scheduled cron endpoint, from the CLI, so
 * operators can recover or test without waiting for the scheduler.
 *
 *   npm run maintenance:run
 *
 * Every task is idempotent — running it twice must not duplicate events,
 * duplicate emails, or corrupt dates. Work is bounded and batched so a large
 * user base cannot exhaust a serverless invocation.
 *
 * Tasks:
 *   1. release stale email-processing locks
 *   2. drain the email outbox (with retries)
 *   3. reconcile expired subscriptions/trials
 *   4. send trial-ending reminders (deduped by idempotency key)
 */

import { prisma } from '../src/lib/prisma';
import {
  processEmailOutbox,
  releaseStaleEmailLocks,
} from '../src/lib/billing/email-outbox';
import {
  reconcileExpiredSubscriptions,
} from '../src/lib/billing/subscriptions';
import { enqueueEmailBestEffort } from '../src/lib/billing/email-outbox';
import { sendTrialEndingReminders } from '../src/lib/billing/trial-reminders';
import { logImportantError, logImportantInfo } from '../src/lib/observability';

async function main() {
  console.log('\n  teChia Jobs — billing & email maintenance\n');

  const released = await releaseStaleEmailLocks();
  console.log(`  Email locks released        ${released}`);

  const outbox = await processEmailOutbox(50);
  console.log(
    `  Outbox processed            ${outbox.sent} sent, ${outbox.failed} failed (of ${outbox.claimed} claimed)`,
  );

  const reconciled = await reconcileExpiredSubscriptions(200);
  console.log(
    `  Subscriptions reconciled    ${reconciled.expired} expired, ${reconciled.failed} failed (of ${reconciled.checked} checked)`,
  );

  const reminders = await sendTrialEndingReminders();
  console.log(
    `  Trial reminders queued      ${reminders.queued} sent, ${reminders.skipped} skipped, ${reconciled.failed} failed`,
  );

  await logImportantInfo({
    event: 'maintenance_run_completed',
    context: { outbox, reconciled, reminders, releasedLocks: released },
  });

  console.log('\n  Done.\n');
}

// Keep the outbox import referenced for clarity alongside the reminder helper.
void enqueueEmailBestEffort;
void prisma;

main()
  .catch((error) => {
    void logImportantError({ event: 'maintenance_run_failed', error });
    console.error('\n  Maintenance failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });