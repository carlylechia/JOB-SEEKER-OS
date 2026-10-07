/**
 * Trial semantics — the highest-risk business logic in the system.
 *
 * Covers the guarantees that a wrong answer here silently costs customers
 * money or support hours:
 *   - existing users get exactly ONE trial
 *   - the launch timestamp is immutable across re-runs
 *   - trials end exactly 14 days after they start
 *   - re-running the initializer never restarts or duplicates
 *   - new users get a 14-day trial from account creation
 *   - expiry reverts to Free WITHOUT deleting data
 *   - admins are exempt entirely
 */

import { describe, it, expect, beforeEach, afterEach } from './harness';
import { prisma } from '@/lib/prisma';
import { initializeMonetization, isMonetizationEnabled } from '@/lib/billing/monetization';
import {
  getEffectiveSubscription,
  startTrial,
  expireTrialIfDue,
} from '@/lib/billing/subscriptions';
import { createUser, destroyUser, setTestNow, resetClock, DAY_MS } from './helpers';

const created: string[] = [];
const CONFIG_ID = 'global';

async function track<T extends { id: string }>(p: Promise<T>): Promise<T> {
  const v = await p;
  created.push(v.id);
  return v;
}

/** Snapshot the real launch timestamp so we can restore it after the suite. */
let originalConfig: { enabledAt: Date | null; existingUserTrialStartedAt: Date | null; existingUserTrialEndsAt: Date | null; initializedAt: Date | null } | null = null;

beforeEach(async () => {
  setTestNow(new Date('2026-03-01T12:00:00.000Z'));
  if (!originalConfig) {
    originalConfig = await prisma.monetizationConfig.findUnique({
      where: { id: CONFIG_ID },
      select: {
        enabledAt: true,
        existingUserTrialStartedAt: true,
        existingUserTrialEndsAt: true,
        initializedAt: true,
      },
    });
  }
});

afterEach(async () => {
  resetClock();
  for (const id of created.splice(0)) {
    await destroyUser(id).catch(() => undefined);
  }
  // Reset config to a clean, un-initialized state.
  await prisma.monetizationConfig
    .update({
      where: { id: CONFIG_ID },
      data: {
        enabledAt: null,
        existingUserTrialStartedAt: null,
        existingUserTrialEndsAt: null,
        initializedAt: null,
      },
    })
    .catch(() => undefined);
});

describe('existing-user trial initialization', () => {
  it('gives every existing user the same trial window anchored to one launch timestamp', async () => {
    const userA = await track(createUser());
    const userB = await track(createUser());

    const launchAt = new Date('2026-03-01T12:00:00.000Z');
    const result = await initializeMonetization({ launchAt, activate: true });

    expect(result.alreadyInitialized).toBe(false);
    expect(result.launchAt.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    // Exactly 14 days.
    expect(result.trialEndsAt.getTime()).toBe(launchAt.getTime() + 14 * DAY_MS);

    for (const user of [userA, userB]) {
      const sub = await prisma.subscription.findUnique({
        where: { userId: user.id },
        include: { plan: true },
      });
      expect(sub).not.toBeNull();
      expect(sub!.plan.code).toBe('PRO');
      expect(sub!.status).toBe('TRIALING');
      expect(sub!.trialStartsAt!.toISOString()).toBe('2026-03-01T12:00:00.000Z');
      expect(sub!.trialEndsAt!.toISOString()).toBe('2026-03-15T12:00:00.000Z');
    }
  });

  it('is idempotent: re-running never restarts the trial or duplicates subscriptions', async () => {
    const user = await track(createUser());
    const launchAt = new Date('2026-03-01T12:00:00.000Z');

    const first = await initializeMonetization({ launchAt, activate: true });
    expect(first.trialsCreated).toBeGreaterThanOrEqual(1);

    const originalSub = await prisma.subscription.findUnique({ where: { userId: user.id } });

    // Run again much later — a different "now" must not move the window.
    setTestNow(new Date('2026-06-15T09:00:00.000Z'));
    const second = await initializeMonetization({ activate: true });

    expect(second.alreadyInitialized).toBe(true);
    expect(second.launchAt.toISOString()).toBe('2026-03-01T12:00:00.000Z');

    const after = await prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(after!.id).toBe(originalSub!.id);
    expect(after!.trialStartsAt!.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(after!.trialEndsAt!.toISOString()).toBe('2026-03-15T12:00:00.000Z');

    // Exactly one subscription row — the unique userId constraint plus the
    // skip logic must prevent duplicates.
    const count = await prisma.subscription.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it('does not overwrite an existing admin-managed paid plan', async () => {
    const user = await track(createUser());
    const premium = await prisma.plan.findUniqueOrThrow({ where: { code: 'PREMIUM' } });

    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: premium.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        source: 'ADMIN_MANUAL',
      },
    });

    await initializeMonetization({ launchAt: new Date('2026-03-01T12:00:00.000Z'), activate: true });

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { userId: user.id },
      include: { plan: true },
    });

    expect(after.plan.code).toBe('PREMIUM');
    expect(after.source).toBe('ADMIN_MANUAL');
    expect(after.trialStartsAt).toBeNull();
  });

  it('exempts admins from the trial entirely', async () => {
    const admin = await track(createUser({ role: 'ADMIN' }));
    await initializeMonetization({ launchAt: new Date('2026-03-01T12:00:00.000Z'), activate: true });

    const sub = await prisma.subscription.findUnique({ where: { userId: admin.id } });
    expect(sub).toBeNull();

    // Admins resolve to unrestricted access regardless.
    const effective = await getEffectiveSubscription(admin.id);
    expect(effective.isAdmin).toBe(true);
  });

  it('activates monetization only after initialization', async () => {
    expect(await isMonetizationEnabled()).toBe(false);
    await initializeMonetization({ launchAt: new Date('2026-03-01T12:00:00.000Z'), activate: true });
    expect(await isMonetizationEnabled()).toBe(true);
  });
});

describe('new-user trial', () => {
  it('starts a 14-day trial at account creation', async () => {
    // Initialize FIRST, then create the user. A user that already exists at
    // activation is an *existing* user and gets the launch-window trial; this
    // test covers the NEW-user path.
    await initializeMonetization({
      launchAt: new Date('2026-03-01T12:00:00.000Z'),
      activate: true,
    });
    const user = await track(createUser());

    const createdAt = new Date('2026-04-01T10:00:00.000Z');
    setTestNow(createdAt);

    const { created, subscription } = await startTrial({
      userId: user.id,
      trialStartsAt: createdAt,
      trialDays: 14,
    });

    expect(created).toBe(true);
    expect(subscription.plan).toBe('PRO');
    expect(subscription.isTrialing).toBe(true);
    // Exact 14 days, no calendar rounding.
    expect(subscription.trialEndsAt!.getTime()).toBe(createdAt.getTime() + 14 * DAY_MS);
  });

  it('never restarts a trial that already exists', async () => {
    const user = await track(createUser());
    const originalStart = new Date('2026-04-01T10:00:00.000Z');

    await startTrial({ userId: user.id, trialStartsAt: originalStart, trialDays: 14 });

    // Log out / log back in / verify email / complete onboarding — none of
    // these may grant more trial time.
    setTestNow(new Date('2026-04-05T12:00:00.000Z'));
    const second = await startTrial({
      userId: user.id,
      trialStartsAt: new Date('2026-04-05T12:00:00.000Z'),
      trialDays: 14,
    });

    expect(second.created).toBe(false);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(sub.trialStartsAt!.toISOString()).toBe(originalStart.toISOString());
    expect(sub.trialEndsAt!.toISOString()).toBe(
      new Date(originalStart.getTime() + 14 * DAY_MS).toISOString(),
    );
  });
});

describe('trial expiry', () => {
  it('reverts to Free at the exact expiry instant without deleting user data', async () => {
    const user = await track(createUser());
    const start = new Date('2026-04-01T10:00:00.000Z');
    const end = new Date(start.getTime() + 14 * DAY_MS);

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

    await startTrial({ userId: user.id, trialStartsAt: start, trialDays: 14 });

    // One millisecond before expiry → still Pro.
    setTestNow(new Date(end.getTime() - 1));
    expect((await getEffectiveSubscription(user.id)).plan).toBe('PRO');

    // Exactly at expiry → Free, immediately, regardless of any cron run.
    setTestNow(end);
    const atExpiry = await getEffectiveSubscription(user.id);
    expect(atExpiry.plan).toBe('FREE');
    expect(atExpiry.status).toBe('EXPIRED');
    expect(atExpiry.isTrialing).toBe(false);
    expect(atExpiry.trialExpired).toBe(true);

    // Data is untouched.
    const jobCount = await prisma.jobLead.count({ where: { userId: user.id } });
    expect(jobCount).toBe(1);
    const account = await prisma.user.findUnique({ where: { id: user.id } });
    expect(account).not.toBeNull();
  });

  it('expireTrialIfDue is idempotent and skips trials that are not yet due', async () => {
    const user = await track(createUser());
    const start = new Date('2026-04-01T10:00:00.000Z');
    const end = new Date(start.getTime() + 14 * DAY_MS);

    await startTrial({ userId: user.id, trialStartsAt: start, trialDays: 14 });

    setTestNow(new Date(end.getTime() - 1));
    expect((await expireTrialIfDue(user.id)).expired).toBe(false);

    setTestNow(new Date(end.getTime() + 1000));
    expect((await expireTrialIfDue(user.id)).expired).toBe(true);
    // Running again must not create a duplicate event.
    expect((await expireTrialIfDue(user.id)).expired).toBe(false);

    const events = await prisma.subscriptionEvent.count({
      where: { userId: user.id, type: 'TRIAL_EXPIRED' },
    });
    expect(events).toBe(1);
  });

  it('a suspended subscription drops paid access while keeping the account usable', async () => {
    const user = await track(createUser());
    const start = new Date('2026-04-01T10:00:00.000Z');
    await startTrial({ userId: user.id, trialStartsAt: start, trialDays: 14 });

    await prisma.subscription.update({
      where: { userId: user.id },
      data: { status: 'SUSPENDED' },
    });

    setTestNow(new Date(start.getTime() + DAY_MS));
    const effective = await getEffectiveSubscription(user.id);
    expect(effective.plan).toBe('FREE');
    expect(effective.status).toBe('SUSPENDED');
  });

  it('keeps paid access alive after a trial ends when a paid window is active', async () => {
    const user = await track(createUser());
    const start = new Date('2026-04-01T10:00:00.000Z');
    await startTrial({ userId: user.id, trialStartsAt: start, trialDays: 14 });

    // Admin converts the trial into a paid Pro plan.
    await prisma.subscription.update({
      where: { userId: user.id },
      data: { status: 'ACTIVE', source: 'ADMIN_MANUAL', endsAt: new Date(start.getTime() + 60 * DAY_MS) },
    });

    setTestNow(new Date(start.getTime() + 20 * DAY_MS));
    const effective = await getEffectiveSubscription(user.id);
    expect(effective.plan).toBe('PRO');
    expect(effective.status).toBe('ACTIVE');
    expect(effective.trialExpired).toBe(true);
  });
});

describe('admin exemption', () => {
  it('gives admins unrestricted access with no subscription at all', async () => {
    const admin = await track(createUser({ role: 'ADMIN' }));
    const effective = await getEffectiveSubscription(admin.id);

    expect(effective.isAdmin).toBe(true);
    expect(effective.plan).toBe('PREMIUM');
    expect(effective.status).toBe('ACTIVE');
  });
});