/**
 * Trial-ending reminders.
 *
 * Sends at most one email per (user, threshold, trial-end-date), enforced by a
 * unique idempotency key on the outbox row. A nightly cron that runs 30 times,
 * or two overlapping invocations, still produce exactly one email.
 *
 * Thresholds are deliberately restrained — no manufactured urgency.
 */

import { prisma } from '@/lib/prisma';
import { now } from './clock';
import { enqueueEmailBestEffort } from './email-outbox';
import { logImportantError, logImportantInfo } from '../observability';

/** Days remaining at which we notify. */
const THRESHOLDS = [3, 1] as const;

/** Per-invocation bound so a large user base cannot blow the execution limit. */
const BATCH_SIZE = 500;

export async function sendTrialEndingReminders(at: Date = now()): Promise<{
  queued: number;
  skipped: number;
  failed: number;
}> {
  let queued = 0;
  let skipped = 0;
  let failed = 0;

  for (const threshold of THRESHOLDS) {
    // Window: trials ending in exactly `threshold` days (±1 day of slack so a
    // daily cron that drifts does not skip anyone).
    const windowStart = new Date(at.getTime() + (threshold - 1) * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(at.getTime() + (threshold + 1) * 24 * 60 * 60 * 1000);

    const trials = await prisma.subscription.findMany({
      where: {
        status: 'TRIALING',
        trialEndsAt: { gt: windowStart, lte: windowEnd },
      },
      select: {
        userId: true,
        trialEndsAt: true,
        user: { select: { email: true } },
      },
      take: BATCH_SIZE,
      orderBy: { trialEndsAt: 'asc' },
    });

    for (const trial of trials) {
      if (!trial.user.email || !trial.trialEndsAt) {
        skipped++;
        continue;
      }

      const trialEndKey = trial.trialEndsAt.toISOString().slice(0, 10);

      try {
        const ok = await enqueueEmailBestEffort({
          type: 'trial_ending',
          recipient: trial.user.email,
          payload: {
            daysRemaining: threshold,
            trialEndsAt: trial.trialEndsAt.toISOString(),
          },
          // Unique key ⇒ a duplicate insert is rejected, never sent twice.
          idempotencyKey: `trial-ending-${threshold}d:${trial.userId}:${trialEndKey}`,
        });

        if (ok) queued++;
        else skipped++;
      } catch (error) {
        // One bad record must never abort the whole batch.
        failed++;
        await logImportantError({
          event: 'trial_reminder_failed',
          userId: trial.userId,
          error,
          context: { threshold },
        });
      }
    }
  }

  await logImportantInfo({
    event: 'trial_reminders_processed',
    context: { queued, skipped, failed },
  });

  return { queued, skipped, failed };
}