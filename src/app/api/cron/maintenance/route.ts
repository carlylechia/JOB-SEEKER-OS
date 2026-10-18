/**
 * GET /api/cron/maintenance
 *
 * Billing + email maintenance, scheduled by Vercel Cron (see vercel.json).
 *
 * SECURITY: requires `Authorization: Bearer <CRON_SECRET>`. The secret is
 * mandatory — this endpoint is refused entirely when CRON_SECRET is unset, so
 * it can never be exposed by a missing configuration. It never trusts query
 * parameters or client-supplied admin flags.
 *
 * IDEMPOTENT: safe to run repeatedly and concurrently.
 *
 * The same work is available offline via `npm run maintenance:run`.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  processEmailOutbox,
  releaseStaleEmailLocks,
} from '@/lib/billing/email-outbox';
import { reconcileExpiredSubscriptions } from '@/lib/billing/subscriptions';
import { sendTrialEndingReminders } from '@/lib/billing/trial-reminders';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { isCronAuthorized } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Fail closed: refused entirely when CRON_SECRET is unset or too short.
  if (!isCronAuthorized(request)) {
    // Deliberately terse — never reveal whether the secret is configured.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const summary = {
    releasedLocks: 0,
    outbox: { claimed: 0, sent: 0, failed: 0 },
    subscriptions: { checked: 0, expired: 0, failed: 0 },
    reminders: { queued: 0, skipped: 0, failed: 0 },
  };

  try {
    // 1. Clear locks stranded by a crashed invocation.
    summary.releasedLocks = await releaseStaleEmailLocks();

    // 2. Drain queued email with bounded retries.
    summary.outbox = await processEmailOutbox(25);

    // 3. Reconcile expired trials/paid windows.
    summary.subscriptions = await reconcileExpiredSubscriptions(200);

    // 4. Trial-ending reminders (deduped by idempotency key).
    summary.reminders = await sendTrialEndingReminders();

    await logImportantInfo({
      event: 'maintenance_run_completed',
      route: '/api/cron/maintenance',
      context: { ...summary, durationMs: Date.now() - started },
    });

    return NextResponse.json(
      { ok: true, summary },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // A systemic failure must be alerted, not silently swallowed.
    await logImportantError({
      event: 'maintenance_run_failed',
      route: '/api/cron/maintenance',
      error,
    });
    return NextResponse.json(
      { ok: false, error: 'Maintenance failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}