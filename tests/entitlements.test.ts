/**
 * Entitlement resolution — the feature-gate security surface.
 *
 * The central claim being tested: a plan gate enforced only in the UI is not a
 * gate. These tests verify the SERVER-side resolver independently of any UI.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  getEntitlements,
  hasEntitlement,
  requireEntitlement,
  PlanRequiredError,
  requiredPlanFor,
  getEffectivePlan,
} from '@/lib/billing/subscriptions';
import {
  resolveFromRecord,
  type SubscriptionRecord,
} from '@/lib/billing/subscriptions';
import { createUser, destroyUser, setTestNow, resetClock, DAY_MS, T0 } from './helpers';

const created: string[] = [];
async function track<T extends { id: string }>(p: Promise<T>): Promise<T> {
  const v = await p;
  created.push(v.id);
  return v;
}

beforeEach(() => setTestNow(new Date(T0)));
afterEach(async () => {
  resetClock();
  for (const id of created.splice(0)) await destroyUser(id).catch(() => undefined);
});

/** Build a subscription row directly, bypassing the trial helpers. */
async function seedSubscription(params: {
  userId: string;
  planCode: 'FREE' | 'PRO' | 'PREMIUM';
  status: 'TRIALING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';
  startsAt: Date;
  endsAt?: Date | null;
  trialEndsAt?: Date | null;
}) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: params.planCode } });
  return prisma.subscription.upsert({
    where: { userId: params.userId },
    update: {
      planId: plan.id,
      status: params.status,
      startsAt: params.startsAt,
      endsAt: params.endsAt ?? null,
      trialEndsAt: params.trialEndsAt ?? null,
      source: 'ADMIN_MANUAL',
    },
    create: {
      userId: params.userId,
      planId: plan.id,
      status: params.status,
      startsAt: params.startsAt,
      endsAt: params.endsAt ?? null,
      trialEndsAt: params.trialEndsAt ?? null,
      source: 'ADMIN_MANUAL',
    },
  });
}

describe('effective plan resolution', () => {
  it('maps a Free user with no subscription to FREE', async () => {
    const user = await track(createUser());
    expect(await getEffectivePlan(user.id)).toBe('FREE');
  });

  it('gives an active Pro subscriber Pro access', async () => {
    const user = await track(createUser());
    await seedSubscription({
      userId: user.id,
      planCode: 'PRO',
      status: 'ACTIVE',
      startsAt: T0,
    });
    expect(await getEffectivePlan(user.id)).toBe('PRO');
  });

  it('reverts to Free the instant a paid window expires, without waiting for cron', async () => {
    const user = await track(createUser());
    const endsAt = new Date(T0.getTime() + 30 * DAY_MS);
    await seedSubscription({ userId: user.id, planCode: 'PRO', status: 'ACTIVE', startsAt: T0, endsAt });

    setTestNow(new Date(endsAt.getTime() - 1000));
    expect(await getEffectivePlan(user.id)).toBe('PRO');

    // Exactly at the boundary the row still says ACTIVE, but access is gone.
    setTestNow(endsAt);
    expect(await getEffectivePlan(user.id)).toBe('FREE');
  });
});

describe('feature entitlements', () => {
  it('denies Pro-only features to a Free user', async () => {
    const user = await track(createUser());
    const entitlements = await getEntitlements(user.id);

    expect(entitlements.plan).toBe('FREE');
    // Free genuinely includes core tracking.
    expect(entitlements.features.JOB_TRACKING).toBe(true);
    expect(entitlements.features.PUBLIC_JOB_IMPORT).toBe(true);
    // Pro-only capability is denied.
    expect(entitlements.features.AI_JOB_ANALYSIS).toBe(false);
  });

  it('grants Pro features to a Pro subscriber', async () => {
    const user = await track(createUser());
    await seedSubscription({ userId: user.id, planCode: 'PRO', status: 'ACTIVE', startsAt: T0 });

    const entitlements = await getEntitlements(user.id);
    expect(entitlements.features.AI_JOB_ANALYSIS).toBe(true);
    expect(entitlements.features.RESUME_OPTIMIZATION).toBe(true);
    // Premium-exclusive remains denied.
    expect(entitlements.features.ADVANCED_PREPARATION).toBe(false);
  });

  it('grants Premium features to a Premium subscriber', async () => {
    const user = await track(createUser());
    await seedSubscription({
      userId: user.id,
      planCode: 'PREMIUM',
      status: 'ACTIVE',
      startsAt: T0,
    });

    const entitlements = await getEntitlements(user.id);
    expect(entitlements.features.ADVANCED_PREPARATION).toBe(true);
    expect(entitlements.features.AI_JOB_ANALYSIS).toBe(true);
  });

  it('grants an admin every feature regardless of subscription', async () => {
    const admin = await track(createUser({ role: 'ADMIN' }));
    const entitlements = await getEntitlements(admin.id);

    expect(entitlements.isAdmin).toBe(true);
    expect(Object.values(entitlements.features).every(Boolean)).toBe(true);
  });

  it('reverts a user to Free entitlements once a trial lapses', async () => {
    const user = await track(createUser());
    const start = T0;
    const end = new Date(T0.getTime() + 14 * DAY_MS);
    await seedSubscription({
      userId: user.id,
      planCode: 'PRO',
      status: 'TRIALING',
      startsAt: start,
      trialEndsAt: end,
    });

    setTestNow(new Date(end.getTime() - 1000));
    expect((await getEntitlements(user.id)).features.AI_JOB_ANALYSIS).toBe(true);

    setTestNow(end);
    const after = await getEntitlements(user.id);
    expect(after.plan).toBe('FREE');
    expect(after.features.AI_JOB_ANALYSIS).toBe(false);
  });
});

describe('requireEntitlement server gate', () => {
  it('throws a structured PlanRequiredError for a Free user', async () => {
    const user = await track(createUser());

    await expect(requireEntitlement(user.id, 'AI_JOB_ANALYSIS')).rejects.toBeInstanceOf(
      PlanRequiredError,
    );

    try {
      await requireEntitlement(user.id, 'AI_JOB_ANALYSIS');
      throw new Error('should have thrown');
    } catch (error) {
      const err = error as PlanRequiredError;
      expect(err.code).toBe('PLAN_REQUIRED');
      expect(err.status).toBe(403);
      // Safe metadata only — no internals leaked.
      const payload = err.toPayload();
      expect(payload.error).toEqual({
        code: 'PLAN_REQUIRED',
        message: 'This feature requires a paid plan.',
        feature: 'AI_JOB_ANALYSIS',
        requiredPlan: 'PRO',
      });
    }
  });

  it('does not throw for an entitled user', async () => {
    const user = await track(createUser());
    await seedSubscription({ userId: user.id, planCode: 'PRO', status: 'ACTIVE', startsAt: T0 });
    await expect(requireEntitlement(user.id, 'AI_JOB_ANALYSIS')).resolves.toBeTruthy();
  });

  it('lets an admin through without any subscription', async () => {
    const admin = await track(createUser({ role: 'ADMIN' }));
    await expect(requireEntitlement(admin.id, 'AI_CAREER_COACH' as never)).resolves.toBeTruthy();
  });

  it('exposes a stable required-plan for UI copy', () => {
    expect(requiredPlanFor('AI_JOB_ANALYSIS')).toBe('PRO');
    expect(requiredPlanFor('ADVANCED_PREPARATION')).toBe('PREMIUM');
    // Free-tier capabilities are granted at the lowest tier.
    expect(requiredPlanFor('JOB_TRACKING')).toBe('FREE');
  });
});

describe('pure resolver (no database)', () => {
  const base: SubscriptionRecord = {
    id: 'sub_1',
    userId: 'u1',
    planId: 'p1',
    status: 'TRIALING',
    startsAt: T0,
    endsAt: null,
    trialStartsAt: T0,
    trialEndsAt: new Date(T0.getTime() + 14 * DAY_MS),
    source: 'TRIAL',
    billingProvider: null,
    externalCustomerId: null,
    externalSubscriptionId: null,
    updatedByAdminId: null,
    adminNote: null,
    createdAt: T0,
    updatedAt: T0,
    plan: { code: 'PRO', name: 'Pro', slug: 'pro', description: '' },
  };

  it('reports an active trial as TRIALING', () => {
    const r = resolveFromRecord(base, new Date(T0.getTime() + DAY_MS));
    expect(r.plan).toBe('PRO');
    expect(r.status).toBe('TRIALING');
    expect(r.isTrialing).toBe(true);
    expect(r.trialDaysRemaining).toBe(13);
  });

  it('reports an elapsed trial as EXPIRED and Free', () => {
    const r = resolveFromRecord(base, new Date(T0.getTime() + 15 * DAY_MS));
    expect(r.plan).toBe('FREE');
    expect(r.status).toBe('EXPIRED');
    expect(r.isTrialing).toBe(false);
    expect(r.trialExpired).toBe(true);
  });

  it('suspends paid access without touching the account', () => {
    const suspended = { ...base, status: 'SUSPENDED' as const };
    const r = resolveFromRecord(suspended, new Date(T0.getTime() + DAY_MS));
    expect(r.plan).toBe('FREE');
    expect(r.status).toBe('SUSPENDED');
  });
});