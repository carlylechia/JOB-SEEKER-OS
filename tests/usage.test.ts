/**
 * Usage accounting tests.
 *
 * Two properties matter here:
 *
 *  1. An allowance is drawn from a shared POOL, not per feature. A Free user
 *     sold 25 AI credits gets 25 AI operations in total, not 25 of each kind.
 *  2. Parallel requests cannot collectively exceed that allowance, because
 *     consumeUsage holds a pool-scoped advisory lock while checking and
 *     incrementing.
 *
 * Both are load-bearing, and (2) is specifically about the lock being keyed on
 * the pool: a per-feature lock would let two different AI features each pass a
 * check against a stale total and jointly overshoot.
 */

import { describe, it, expect, afterEach } from './harness';
import { prisma } from '@/lib/prisma';
import {
  consumeUsage,
  getUsage,
  getPoolUsage,
  getPoolUsageSummary,
  checkUsageLimit,
  featuresInPool,
  poolForFeature,
  UsageLimitExceededError,
} from '@/lib/billing/usage';
import { FEATURE_ENTITLEMENTS, type FeatureKey } from '@/lib/billing/plans';
import { createUser, destroyUser, setTestNow, resetClock, T0 } from './helpers';

const created: string[] = [];
async function track<T extends { id: string }>(p: Promise<T>): Promise<T> {
  const v = await p;
  created.push(v.id);
  return v;
}

afterEach(async () => {
  resetClock();
  for (const id of created.splice(0)) await destroyUser(id).catch(() => undefined);
});

describe('usage accounting', () => {
  it('accumulates units in the current UTC period', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 3, { pool: 'AI', limit: 100 });
    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 2, { pool: 'AI', limit: 100 });

    expect(await getUsage(user.id, 'AI_JOB_ANALYSIS')).toBe(5);
  });

  it('enforces a limit and throws before consuming', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 4, { pool: 'AI', limit: 5 });

    await expect(
      consumeUsage(user.id, 'AI_JOB_ANALYSIS', 3, { pool: 'AI', limit: 5 }),
    ).rejects.toBeInstanceOf(UsageLimitExceededError);

    // The rejected consumption must not have been recorded.
    expect(await getUsage(user.id, 'AI_JOB_ANALYSIS')).toBe(4);
  });

  it('treats a null limit as unlimited', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 10_000, { pool: 'AI', limit: null });
    expect(await getUsage(user.id, 'AI_JOB_ANALYSIS')).toBe(10_000);
  });

  it('does not double-count when an idempotency key is reused', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    const first = await consumeUsage(user.id, 'RESUME_OPTIMIZATION', 1, {
      pool: 'AI',
      limit: 100,
      idempotencyKey: 'resume-opt:job123',
    });
    const second = await consumeUsage(user.id, 'RESUME_OPTIMIZATION', 1, {
      pool: 'AI',
      limit: 100,
      idempotencyKey: 'resume-opt:job123',
    });

    expect(first.consumed).toBe(1);
    expect(second.consumed).toBe(0);
    expect(await getUsage(user.id, 'RESUME_OPTIMIZATION')).toBe(1);
  });

  it('serialises parallel requests so a burst cannot overshoot the limit', async () => {
    setTestNow(T0);
    const user = await track(createUser());
    const LIMIT = 5;

    // 10 concurrent single-unit attempts against a limit of 5.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        consumeUsage(user.id, 'AI_COVER_LETTER', 1, { pool: 'AI', limit: LIMIT }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;

    // Exactly the limit was granted — never more.
    expect(await getPoolUsage(user.id, 'AI')).toBeLessThanOrEqual(LIMIT);
    expect(succeeded).toBeLessThanOrEqual(LIMIT);
    expect(succeeded).toBeGreaterThan(0);
  });

  it('reports remaining allowance without consuming', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 2, { pool: 'AI', limit: 10 });
    const check = await checkUsageLimit(user.id, 'AI', 1, 10);
    expect(check.used).toBe(2);
    expect(check.allowed).toBe(true);

    const over = await checkUsageLimit(user.id, 'AI', 9, 10);
    expect(over.allowed).toBe(false);
  });

  it('starts a fresh period next month', async () => {
    setTestNow(new Date('2026-03-15T00:00:00.000Z'));
    const user = await track(createUser());
    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 5, { pool: 'AI', limit: 100 });
    expect(await getUsage(user.id, 'AI_JOB_ANALYSIS')).toBe(5);

    // Move into April — the March rows are retained (auditable) but the
    // current period reads zero.
    setTestNow(new Date('2026-04-02T00:00:00.000Z'));
    expect(await getUsage(user.id, 'AI_JOB_ANALYSIS')).toBe(0);

    // History is preserved, not deleted.
    const all = await prisma.usageRecord.count({ where: { userId: user.id } });
    expect(all).toBe(1);
  });
});

describe('shared pools', () => {
  it('counts every feature in the pool against one allowance', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    // Three different AI capabilities, one budget of 5.
    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 3, { pool: 'AI', limit: 5 });
    await consumeUsage(user.id, 'AI_RESUME_PARSER', 1, { pool: 'AI', limit: 5 });
    await consumeUsage(user.id, 'RESUME_OPTIMIZATION', 1, { pool: 'AI', limit: 5 });

    // Each feature individually is well under the limit — the pool total is not.
    expect(await getUsage(user.id, 'AI_JOB_ANALYSIS')).toBe(3);
    expect(await getPoolUsage(user.id, 'AI')).toBe(5);

    // The next request of ANY kind is refused.
    await expect(
      consumeUsage(user.id, 'AI_COVER_LETTER', 1, { pool: 'AI', limit: 5 }),
    ).rejects.toBeInstanceOf(UsageLimitExceededError);
    expect(await getPoolUsage(user.id, 'AI')).toBe(5);
  });

  it('serialises a burst that SPANS features in the same pool', async () => {
    setTestNow(T0);
    const user = await track(createUser());
    const LIMIT = 6;

    // The adversarial case for a per-feature lock: half the burst hits one
    // feature and half hits another. With a feature-scoped lock each group
    // sees its own pre-burst total, both pass, and the pool overshoots.
    const features: FeatureKey[] = ['AI_JOB_ANALYSIS', 'AI_RESUME_PARSER'];
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        consumeUsage(user.id, features[i % 2], 1, { pool: 'AI', limit: LIMIT }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    expect(succeeded).toBe(LIMIT);
    expect(await getPoolUsage(user.id, 'AI')).toBe(LIMIT);
  });

  it('ignores usage recorded against features outside the pool', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    // Not produced by consumeUsage — which refuses the mismatch — but a row
    // could still arrive from a backfill, a manual correction or a future
    // migration. It must not silently inflate a customer's balance.
    await prisma.usageRecord.create({
      data: {
        userId: user.id,
        featureKey: 'JOB_TRACKING',
        units: 99,
        periodStart: new Date(T0.getUTCFullYear(), T0.getUTCMonth(), 1),
        periodEnd: new Date(Date.UTC(T0.getUTCFullYear(), T0.getUTCMonth() + 1, 1)),
      },
    });

    expect(await getPoolUsage(user.id, 'AI')).toBe(0);
  });

  it('refuses to charge a feature to a pool it does not belong to', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    // JOB_TRACKING is unmetered. Recording it against the AI pool would write
    // usage that is charged to nobody and enforced against nobody.
    await expect(
      consumeUsage(user.id, 'JOB_TRACKING', 1, { pool: 'AI', limit: 100 }),
    ).rejects.toThrow(/does not draw on usage pool/);

    expect(await prisma.usageRecord.count({ where: { userId: user.id } })).toBe(0);
  });

  it('breaks the shared total down by feature', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 3, { pool: 'AI', limit: 25 });
    await consumeUsage(user.id, 'RESUME_OPTIMIZATION', 2, { pool: 'AI', limit: 25 });

    const summary = await getPoolUsageSummary(user.id, 'AI', 25);

    expect(summary.pool).toBe('AI');
    expect(summary.used).toBe(5);
    expect(summary.remaining).toBe(20);
    // The breakdown must reconcile with the total, or the UI would lie.
    expect(summary.byFeature.reduce((n, f) => n + f.used, 0)).toBe(summary.used);
    expect(summary.byFeature).toEqual([
      { feature: 'AI_JOB_ANALYSIS', used: 3 },
      { feature: 'RESUME_OPTIMIZATION', used: 2 },
    ]);
    // Largest consumer first, so the UI can lead with what they spent on.
    expect(summary.byFeature[0].used).toBeGreaterThanOrEqual(summary.byFeature[1].used);
  });

  it('reports no remaining figure when the pool is unlimited', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    const summary = await getPoolUsageSummary(user.id, 'AI', null);
    expect(summary.used).toBe(0);
    expect(summary.remaining).toBeNull();
    expect(summary.limit).toBeNull();
  });

  it('resolves pool membership from the feature registry', () => {
    // Every metered feature must be attributed to a pool, and every pool must
    // agree with the registry in both directions.
    for (const feature of Object.keys(FEATURE_ENTITLEMENTS) as FeatureKey[]) {
      const pool = poolForFeature(feature);
      if (pool === null) continue;
      expect(featuresInPool(pool)).toContain(feature);
      expect(poolForFeature(feature)).toBe(pool);
    }

    // The shipped AI capabilities all draw on the one allowance.
    for (const feature of [
      'AI_RESUME_PARSER',
      'AI_JOB_ANALYSIS',
      'RESUME_OPTIMIZATION',
    ] as FeatureKey[]) {
      expect(poolForFeature(feature)).toBe('AI');
    }

    // Unmetered capabilities draw on nothing.
    for (const feature of ['JOB_TRACKING', 'RESUME_BUILDER', 'RESUME_UPLOAD'] as FeatureKey[]) {
      expect(poolForFeature(feature)).toBeNull();
      expect(featuresInPool('AI')).not.toContain(feature);
    }
  });
});