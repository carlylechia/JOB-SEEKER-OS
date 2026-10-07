/**
 * Durable transactional email outbox.
 *
 * THE PROBLEM THIS SOLVES: this application has previously reported business
 * failures when the email provider failed. A Resend timeout must never make a
 * successfully-created account or a successfully-changed plan look failed.
 *
 * THE PATTERN:
 *   1. Business work + outbox row commit in ONE database transaction.
 *   2. Delivery happens afterwards, out of band, with bounded retries.
 *
 * A failed provider call therefore:
 *   - never rolls back or fails the business transaction,
 *   - is persisted for retry,
 *   - is observable,
 *   - and never fabricates a successful delivery record.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { renderEmail, type EmailTemplateId } from './email-templates';

export const EMAIL_TYPES = [
  'verification',
  'password_reset',
  'trial_started',
  'trial_ending',
  'trial_expired',
  'upgrade_request_received',
  'admin_upgrade_request_notification',
  'plan_changed',
  'upgrade_request_resolved',
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];

const MAX_ATTEMPTS = 6;
/** Base for exponential backoff: attempt 1 → ~1 min, doubling thereafter. */
const BACKOFF_BASE_MS = 60_000;

/**
 * Enqueue an email INSIDE an open transaction.
 *
 * Passing the transaction client is what guarantees "the email is either
 * queued with the business change, or neither happened". Never call Resend
 * from inside a transaction — that holds database locks across network I/O.
 */
export async function enqueueEmail(
  tx: Prisma.TransactionClient,
  params: {
    type: EmailType;
    recipient: string;
    payload: Record<string, unknown>;
    /** Unique dedupe key, e.g. `trial-ending-3-days:<userId>:<isoDate>`. */
    idempotencyKey?: string;
  },
): Promise<void> {
  const { type, recipient, payload, idempotencyKey } = params;

  await tx.emailOutbox.create({
    data: {
      type,
      recipient,
      payload: payload as object,
      idempotencyKey: idempotencyKey ?? null,
    },
  });
}

/**
 * Enqueue outside a transaction (best-effort). Used where the business change
 * has already committed and email failure must not affect the response.
 */
export async function enqueueEmailBestEffort(params: {
  type: EmailType;
  recipient: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<boolean> {
  try {
    await prisma.emailOutbox.create({
      data: {
        type: params.type,
        recipient: params.recipient,
        payload: params.payload as object,
        idempotencyKey: params.idempotencyKey ?? null,
      },
    });
    return true;
  } catch (error) {
    await logImportantError({
      event: 'email_outbox_enqueue_failed',
      error,
      context: { type: params.type },
    });
    return false;
  }
}

type OutboxRow = {
  id: string;
  type: string;
  recipient: string;
  payload: unknown;
  attempts: number;
};

/**
 * Claim a batch of due messages.
 *
 * Uses a conditional UPDATE to move rows to PROCESSING so concurrent workers
 * cannot both send the same message — the same pattern for both claim and
 * completion.
 */
async function claimBatch(limit: number): Promise<OutboxRow[]> {
  const due = await prisma.emailOutbox.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, type: true, recipient: true, payload: true, attempts: true },
  });

  const claimed: OutboxRow[] = [];

  for (const row of due) {
    // Atomic claim: only update if still PENDING.
    const result = await prisma.emailOutbox.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'PROCESSING', updatedAt: new Date() },
    });
    if (result.count === 1) claimed.push(row);
  }

  return claimed;
}

/**
 * Deliver one message. Never throws — failures are persisted for retry.
 */
async function deliver(row: OutboxRow): Promise<boolean> {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured; cannot deliver transactional email.');
    }

    const template = row.type as EmailTemplateId;
    const { subject, html, text } = renderEmail(template, (row.payload ?? {}) as Record<string, unknown>);

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'teChia Jobs <noreply@example.com>',
      to: row.recipient,
      subject,
      html,
      text,
      ...(process.env.EMAIL_REPLY_TO ? { replyTo: process.env.EMAIL_REPLY_TO } : {}),
    });

    if (error) throw new Error(error.message);

    await prisma.emailOutbox.update({
      where: { id: row.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
        providerMessageId: data?.id ?? null,
      },
    });

    await logImportantInfo({
      event: 'email_outbox_sent',
      context: { type: row.type },
    });
    return true;
  } catch (error) {
    const attempts = row.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;

    // Exponential backoff, bounded — never retry forever, never hammer Resend.
    const backoffMs = BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
    const nextAttemptAt = new Date(Date.now() + backoffMs);

    await prisma.emailOutbox.update({
      where: { id: row.id },
      data: {
        status: exhausted ? 'FAILED' : 'PENDING',
        attempts,
        nextAttemptAt,
        // Never persist secrets or tokens in the error text.
        lastError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'Unknown delivery error',
      },
    });

    await logImportantError({
      event: exhausted ? 'email_outbox_failed' : 'email_outbox_retry_scheduled',
      error,
      context: {
        type: row.type,
        attempts,
        exhausted,
        // Recipient domain only — avoid logging full addresses unnecessarily.
        recipientDomain: row.recipient.split('@')[1] ?? 'unknown',
      },
    });

    return false;
  }
}

/**
 * Process the outbox. Safe to run repeatedly and concurrently.
 * Bounded so a serverless invocation cannot run away.
 */
export async function processEmailOutbox(limit = 25): Promise<{
  claimed: number;
  sent: number;
  failed: number;
}> {
  const rows = await claimBatch(limit);

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const ok = await deliver(row);
    if (ok) sent++;
    else failed++;
  }

  return { claimed: rows.length, sent, failed };
}

/**
 * Release PROCESSING rows stranded by a crashed/timeout invocation so they
 * become deliverable again. Stale-lock cleanup, safe to run repeatedly.
 */
export async function releaseStaleEmailLocks(
  olderThanMinutes = 15,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const result = await prisma.emailOutbox.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
    data: { status: 'PENDING', nextAttemptAt: new Date() },
  });
  return result.count;
}

/** Health summary for the admin system view. Never exposes secrets. */
export async function getEmailOutboxHealth() {
  const [pending, processing, failed, sent, oldestPending] = await Promise.all([
    prisma.emailOutbox.count({ where: { status: 'PENDING' } }),
    prisma.emailOutbox.count({ where: { status: 'PROCESSING' } }),
    prisma.emailOutbox.count({ where: { status: 'FAILED' } }),
    prisma.emailOutbox.count({ where: { status: 'SENT' } }),
    prisma.emailOutbox.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  return {
    pending,
    processing,
    failed,
    sent,
    oldestPendingAt: oldestPending?.createdAt ?? null,
    configured: Boolean(process.env.RESEND_API_KEY),
  };
}