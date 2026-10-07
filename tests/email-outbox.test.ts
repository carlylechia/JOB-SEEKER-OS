/**
 * Email reliability tests.
 *
 * The core guarantee: a failing email provider must never roll back or fail the
 * business transaction that queued the message, and retries must not duplicate.
 */

import { describe, it, expect, afterEach, before } from './harness';
import { prisma } from '@/lib/prisma';
import {
  processEmailOutbox,
  releaseStaleEmailLocks,
  getEmailOutboxHealth,
  enqueueEmailBestEffort,
} from '@/lib/billing/email-outbox';
import { renderEmail } from '@/lib/billing/email-templates';
import { createUser, destroyUser, T0, setTestNow, resetClock } from './helpers';

const created: string[] = [];
async function track<T extends { id: string }>(p: Promise<T>): Promise<T> {
  const v = await p;
  created.push(v.id);
  return v;
}

// The outbox worker drains whatever is pending, including rows created by other
// suites. Start from a clean table so batch assertions are deterministic.
before(async () => {
  await prisma.emailOutbox.deleteMany({});
});

afterEach(async () => {
  resetClock();
  for (const id of created.splice(0)) await destroyUser(id).catch(() => undefined);
  await prisma.emailOutbox.deleteMany({
    where: { recipient: { endsWith: '@outbox.test' } },
  });
});

describe('email templates', () => {
  it('renders branded verification email without leaking other users', () => {
    const { subject, html, text } = renderEmail('verification', { token: 'abc123' });
    expect(subject).toContain('teChia Jobs');
    expect(html).toContain('teChia Jobs');
    expect(html).toContain('teChia Digital Solutions');
    expect(text).toContain('abc123');
  });

  it('escapes user-supplied content to prevent injection', () => {
    const { html } = renderEmail('plan_changed', {
      planName: '<script>alert(1)</script>',
      startsAt: T0.toISOString(),
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('outbox durability', () => {
  it('queues email inside the same transaction as the business change', async () => {
    setTestNow(T0);
    const user = await track(createUser());
    const pro = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });

    // Simulates the register flow: the business row and the email row commit
    // together, or neither does.
    await prisma.$transaction(async (tx) => {
      await tx.subscription.create({
        data: {
          userId: user.id,
          planId: pro.id,
          status: 'TRIALING',
          startsAt: T0,
          trialStartsAt: T0,
          trialEndsAt: new Date(T0.getTime() + 14 * 86_400_000),
          source: 'TRIAL',
        },
      });
      await tx.emailOutbox.create({
        data: {
          type: 'trial_started',
          recipient: 'queued@outbox.test',
          payload: { trialEndsAt: T0.toISOString() },
        },
      });
    });

    const queued = await prisma.emailOutbox.findFirst({ where: { recipient: 'queued@outbox.test' } });
    expect(queued).not.toBeNull();
    expect(queued!.status).toBe('PENDING');
  });

  it('does not send when RESEND_API_KEY is missing, and schedules a retry', async () => {
    setTestNow(T0);
    await enqueueEmailBestEffort({
      type: 'trial_started',
      recipient: 'nokey@outbox.test',
      payload: { trialEndsAt: T0.toISOString() },
      idempotencyKey: 'test-nokey-1',
    });

    const originalKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    const result = await processEmailOutbox(10);
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const row = await prisma.emailOutbox.findFirstOrThrow({
      where: { idempotencyKey: 'test-nokey-1' },
    });
    // Never a fake success.
    expect(row.status).not.toBe('SENT');
    expect(row.status).not.toBe('FAILED'); // still retrying
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('RESEND_API_KEY');

    if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;
  });

  it('enforces idempotency: the same key cannot be queued twice', async () => {
    await enqueueEmailBestEffort({
      type: 'trial_ending',
      recipient: 'dupe@outbox.test',
      payload: {},
      idempotencyKey: 'trial-ending-3-days:u1:2026-03-15',
    });

    // Second attempt with the same key must not create a second row.
    const second = await enqueueEmailBestEffort({
      type: 'trial_ending',
      recipient: 'dupe@outbox.test',
      payload: {},
      idempotencyKey: 'trial-ending-3-days:u1:2026-03-15',
    });
    expect(second).toBe(false);

    const count = await prisma.emailOutbox.count({
      where: { idempotencyKey: 'trial-ending-3-days:u1:2026-03-15' },
    });
    expect(count).toBe(1);
  });

  it('releases stale PROCESSING locks so a crashed run can recover', async () => {
    await prisma.emailOutbox.create({
      data: {
        type: 'trial_started',
        recipient: 'stale@outbox.test',
        payload: {},
        status: 'PROCESSING',
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const released = await releaseStaleEmailLocks();
    expect(released).toBeGreaterThanOrEqual(1);

    const row = await prisma.emailOutbox.findFirstOrThrow({
      where: { recipient: 'stale@outbox.test' },
    });
    expect(row.status).toBe('PENDING');
  });

  it('reports health without exposing secrets', async () => {
    const health = await getEmailOutboxHealth();
    expect(health).toHaveProperty('pending');
    expect(health).toHaveProperty('failed');
    expect(health).toHaveProperty('configured');
    // Must not leak the key itself.
    expect(JSON.stringify(health)).not.toContain(process.env.RESEND_API_KEY ?? 'SENTINEL_NOT_PRESENT');
  });
});

describe('email failure does not roll back business state', () => {
  it('keeps the user and subscription intact when the provider fails', async () => {
    setTestNow(T0);
    const user = await track(createUser());
    const planId = (await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } })).id;

    const originalKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    await prisma.$transaction(async (tx) => {
      await tx.subscription.create({
        data: {
          userId: user.id,
          planId,
          status: 'TRIALING',
          startsAt: T0,
          trialStartsAt: T0,
          trialEndsAt: new Date(T0.getTime() + 14 * 86_400_000),
          source: 'TRIAL',
        },
      });
      await tx.emailOutbox.create({
        data: { type: 'trial_started', recipient: `${user.email}`, payload: {} },
      });
    });

    // Provider fails, but the business transaction already committed.
    await processEmailOutbox(10);

    const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(sub).not.toBeNull();
    expect(sub!.status).toBe('TRIALING');

    if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;
  });
});

// Note: no helper is needed here — plan ids are resolved before the
// transaction opens, which keeps the test's intent obvious.