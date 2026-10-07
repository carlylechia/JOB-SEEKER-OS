/**
 * Admin plan-change and upgrade-request workflow tests.
 *
 * Exercises the full operator path and the concurrency guarantee that two
 * admins acting on the same request cannot double-apply it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  adminChangePlan,
  adminExtendTrial,
  adminSuspendPlan,
  PlanChangeError,
} from '@/lib/billing/admin-plan-service';
import {
  createUpgradeRequest,
  cancelOwnUpgradeRequest,
  DuplicateRequestError,
} from '@/lib/billing/upgrade-request-service';
import { upgradeRequestSchema } from '@/lib/billing/upgrade-requests';
import { getEffectiveSubscription } from '@/lib/billing/subscriptions';
import { createUser, destroyUser, setTestNow, resetClock, T0, DAY_MS } from './helpers';

const created: string[] = [];
async function track<T extends { id: string }>(p: Promise<T>): Promise<T> {
  const v = await p;
  created.push(v.id);
  return v;
}

afterEach(async () => {
  resetClock();
  for (const id of created.splice(0)) await destroyUser(id).catch(() => undefined);
  // Clear any queued notification rows with no owner.
  await prisma.notification.deleteMany({ where: { user: null } }).catch(() => undefined);
});

describe('admin plan changes', () => {
  it('applies a plan, writes an audit event, and notifies the user', async () => {
    setTestNow(T0);
    const admin = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());

    const result = await adminChangePlan({
      userId: user.id,
      planCode: 'PRO',
      reason: 'Payment confirmed via WhatsApp',
      adminId: admin.id,
    });

    expect(result.effective.plan).toBe('PRO');
    expect(result.effective.status).toBe('ACTIVE');

    // Audit trail.
    const event = await prisma.subscriptionEvent.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(event.type).toBe('PLAN_UPGRADED');
    expect(event.newPlanCode).toBe('PRO');
    expect(event.reason).toBe('Payment confirmed via WhatsApp');
    expect(event.actorAdminId).toBe(admin.id);

    // In-app notification created.
    const note = await prisma.notification.findFirst({ where: { userId: user.id } });
    expect(note).not.toBeNull();
  });

  it('refuses a change with no reason', async () => {
    const admin = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());

    await expect(
      adminChangePlan({ userId: user.id, planCode: 'PRO', reason: '', adminId: admin.id }),
    ).rejects.toBeInstanceOf(PlanChangeError);
  });

  it('rejects an expiration that precedes the start', async () => {
    const admin = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());

    await expect(
      adminChangePlan({
        userId: user.id,
        planCode: 'PRO',
        startsAt: T0,
        endsAt: new Date(T0.getTime() - DAY_MS),
        reason: 'Backdating test',
        adminId: admin.id,
      }),
    ).rejects.toBeInstanceOf(PlanChangeError);
  });

  it('rejects a non-admin actor even if the role changed mid-flight', async () => {
    const admin = await track(createUser({ role: 'ADMIN' }));
    const impostor = await track(createUser());

    await expect(
      adminChangePlan({
        userId: admin.id,
        planCode: 'PRO',
        reason: 'Escalation attempt',
        adminId: impostor.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('supports an expiring promotional plan', async () => {
    setTestNow(T0);
    const admin = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());

    await adminChangePlan({
      userId: user.id,
      planCode: 'PREMIUM',
      startsAt: T0,
      endsAt: new Date(T0.getTime() + 30 * DAY_MS),
      reason: 'Promotional upgrade',
      adminId: admin.id,
    });

    setTestNow(new Date(T0.getTime() + 30 * DAY_MS));
    expect((await getEffectiveSubscription(user.id)).plan).toBe('FREE');
  });

  it('downgrades Premium to Free without deleting user data', async () => {
    setTestNow(T0);
    const admin = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());

    await prisma.jobLead.create({
      data: {
        userId: user.id,
        company: 'Acme',
        title: 'Engineer',
        score: {},
        checklist: {},
        contacts: [],
        interviews: [],
        prepPack: {},
      },
    });

    await adminChangePlan({ userId: user.id, planCode: 'PREMIUM', reason: 'Up', adminId: admin.id });
    await adminChangePlan({
      userId: user.id,
      planCode: 'FREE',
      reason: 'Refund agreed',
      adminId: admin.id,
    });

    expect((await getEffectiveSubscription(user.id)).plan).toBe('FREE');
    // Data preserved.
    expect(await prisma.jobLead.count({ where: { userId: user.id } })).toBe(1);
  });

  it('extends a trial without moving the original start', async () => {
    setTestNow(T0);
    const admin = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());

    const start = T0;
    const originalEnd = new Date(T0.getTime() + 14 * DAY_MS);
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: (await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } })).id,
        status: 'TRIALING',
        startsAt: start,
        trialStartsAt: start,
        trialEndsAt: originalEnd,
        source: 'TRIAL',
      },
    });

    const newEnd = new Date(T0.getTime() + 21 * DAY_MS);
    await adminExtendTrial({
      userId: user.id,
      newTrialEndsAt: newEnd,
      reason: 'Support resolution',
      adminId: admin.id,
    });

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
    // Start is untouched; only the end moved.
    expect(sub.trialStartsAt!.toISOString()).toBe(start.toISOString());
    expect(sub.trialEndsAt!.toISOString()).toBe(newEnd.toISOString());
  });

  it('refuses to shorten a trial', async () => {
    setTestNow(T0);
    const admin = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());

    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: (await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } })).id,
        status: 'TRIALING',
        startsAt: T0,
        trialStartsAt: T0,
        trialEndsAt: new Date(T0.getTime() + 14 * DAY_MS),
        source: 'TRIAL',
      },
    });

    await expect(
      adminExtendTrial({
        userId: user.id,
        newTrialEndsAt: new Date(T0.getTime() + 7 * DAY_MS),
        reason: 'Shorten attempt',
        adminId: admin.id,
      }),
    ).rejects.toBeInstanceOf(PlanChangeError);
  });

  it('suspends paid access while keeping the account', async () => {
    setTestNow(T0);
    const admin = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());

    await adminChangePlan({ userId: user.id, planCode: 'PRO', reason: 'Up', adminId: admin.id });
    await adminSuspendPlan({ userId: user.id, reason: 'Chargeback', adminId: admin.id });

    const effective = await getEffectiveSubscription(user.id);
    expect(effective.plan).toBe('FREE');
    expect(effective.status).toBe('SUSPENDED');
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });
});

describe('upgrade requests', () => {
  it('creates a request with a plan snapshot', async () => {
    const user = await track(createUser());
    const input = upgradeRequestSchema.parse({
      requestedPlan: 'PRO',
      contactMethod: 'EMAIL',
      contactEmail: 'user@example.com',
      message: 'I would like resume help.',
    });

    const created = await createUpgradeRequest({ userId: user.id, input });
    expect(created.status).toBe('PENDING');

    const row = await prisma.upgradeRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.requestedPlan).toBe('PRO');
    expect(row.currentPlanSnapshot).toBe('FREE');
  });

  it('blocks a duplicate open request instead of spamming', async () => {
    const user = await track(createUser());
    const input = upgradeRequestSchema.parse({
      requestedPlan: 'PRO',
      contactMethod: 'EMAIL',
      contactEmail: 'user@example.com',
      message: 'First',
    });

    await createUpgradeRequest({ userId: user.id, input });

    await expect(createUpgradeRequest({ userId: user.id, input })).rejects.toBeInstanceOf(
      DuplicateRequestError,
    );

    // Exactly one row, not a pile.
    expect(await prisma.upgradeRequest.count({ where: { userId: user.id } })).toBe(1);
  });

  it('allows a new request after the previous one is resolved', async () => {
    const user = await track(createUser());
    const input = upgradeRequestSchema.parse({
      requestedPlan: 'PRO',
      contactMethod: 'EMAIL',
      contactEmail: 'user@example.com',
      message: 'First',
    });

    const first = await createUpgradeRequest({ userId: user.id, input });
    await prisma.upgradeRequest.update({
      where: { id: first.id },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });

    const second = await createUpgradeRequest({ userId: user.id, input });
    expect(second.id).not.toBe(first.id);
  });

  it('a user cannot cancel another user request', async () => {
    const owner = await track(createUser());
    const attacker = await track(createUser());
    const input = upgradeRequestSchema.parse({
      requestedPlan: 'PRO',
      contactMethod: 'EMAIL',
      contactEmail: 'owner@example.com',
      message: 'hi',
    });

    const request = await createUpgradeRequest({ userId: owner.id, input });

    await expect(
      cancelOwnUpgradeRequest({ userId: attacker.id, requestId: request.id }),
    ).rejects.toThrow();
  });

  it('a user cannot set APPROVED on their own request', async () => {
    const user = await track(createUser());
    const input = upgradeRequestSchema.parse({
      requestedPlan: 'PRO',
      contactMethod: 'EMAIL',
      contactEmail: 'user@example.com',
      message: 'hi',
    });
    const request = await createUpgradeRequest({ userId: user.id, input });

    // Schema rejects an unknown `status` field outright.
    const parsed = upgradeRequestSchema.safeParse({ ...input, status: 'APPROVED' });
    expect(parsed.success).toBe(false);

    // And the persisted row is still PENDING.
    const row = await prisma.upgradeRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe('PENDING');
  });

  it('enforces the state machine: a resolved request cannot be re-resolved', async () => {
    const { adminUpdateUpgradeRequestStatus } = await import(
      '@/lib/billing/upgrade-request-service'
    );
    const admin = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());
    const input = upgradeRequestSchema.parse({
      requestedPlan: 'PRO',
      contactMethod: 'EMAIL',
      contactEmail: 'user@example.com',
      message: 'hi',
    });
    const request = await createUpgradeRequest({ userId: user.id, input });

    await adminUpdateUpgradeRequestStatus({
      requestId: request.id,
      to: 'REJECTED',
      adminId: admin.id,
    });

    // Second resolution must conflict, not silently re-apply.
    await expect(
      adminUpdateUpgradeRequestStatus({
        requestId: request.id,
        to: 'APPROVED',
        adminId: admin.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('two admins approving the same request yields one plan change', async () => {
    setTestNow(T0);
    const adminA = await track(createUser({ role: 'ADMIN' }));
    const adminB = await track(createUser({ role: 'ADMIN' }));
    const user = await track(createUser());

    const input = upgradeRequestSchema.parse({
      requestedPlan: 'PRO',
      contactMethod: 'EMAIL',
      contactEmail: 'user@example.com',
      message: 'hi',
    });
    const request = await createUpgradeRequest({ userId: user.id, input });

    // Admin A wins.
    await adminChangePlan({
      userId: user.id,
      planCode: 'PRO',
      reason: 'Payment confirmed',
      adminId: adminA.id,
      resolveUpgradeRequestId: request.id,
    });

    // Admin B holds a stale copy — must conflict rather than double-apply.
    await expect(
      adminChangePlan({
        userId: user.id,
        planCode: 'PRO',
        reason: 'Payment confirmed',
        adminId: adminB.id,
        resolveUpgradeRequestId: request.id,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_ALREADY_RESOLVED' });

    // Exactly one upgrade event for this plan.
    const events = await prisma.subscriptionEvent.count({
      where: { userId: user.id, type: 'PLAN_UPGRADED' },
    });
    expect(events).toBe(1);
  });
});