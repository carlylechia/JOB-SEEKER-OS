/**
 * Usage accounting tests, including the concurrency guarantee.
 *
 * The key property: parallel requests cannot collectively exceed a limit,
 * because consumeUsage holds a row lock while checking and incrementing.
 */

import { describe, it, expect, afterEach } from './harness';
import { prisma } from '@/lib/prisma';
import {
  consumeUsage,
  getUsage,
  checkUsageLimit,
  UsageLimitExceededError,
} from '@/lib/billing/usage';
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

    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 3, { limit: 100 });
    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 2, { limit: 100 });

    expect(await getUsage(user.id, 'AI_JOB_ANALYSIS')).toBe(5);
  });

  it('enforces a limit and throws before consuming', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 4, { limit: 5 });

    await expect(
      consumeUsage(user.id, 'AI_JOB_ANALYSIS', 3, { limit: 5 }),
    ).rejects.toBeInstanceOf(UsageLimitExceededError);

    // The rejected consumption must not have been recorded.
    expect(await getUsage(user.id, 'AI_JOB_ANALYSIS')).toBe(4);
  });

  it('treats a null limit as unlimited', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 10_000, { limit: null });
    expect(await getUsage(user.id, 'AI_JOB_ANALYSIS')).toBe(10_000);
  });

  it('does not double-count when an idempotency key is reused', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    const first = await consumeUsage(user.id, 'RESUME_OPTIMIZATION', 1, {
      limit: 100,
      idempotencyKey: 'resume-opt:job123',
    });
    const second = await consumeUsage(user.id, 'RESUME_OPTIMIZATION', 1, {
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
        consumeUsage(user.id, 'AI_COVER_LETTER', 1, { limit: LIMIT }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const used = await getUsage(user.id, 'AI_COVER_LETTER');

    // Exactly the limit was granted — never more.
    expect(used).toBeLessThanOrEqual(LIMIT);
    expect(succeeded).toBeLessThanOrEqual(LIMIT);
    expect(succeeded).toBeGreaterThan(0);
  });

  it('reports remaining allowance without consuming', async () => {
    setTestNow(T0);
    const user = await track(createUser());

    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 2, { limit: 10 });
    const check = await checkUsageLimit(user.id, 'AI_JOB_ANALYSIS', 1, 10);
    expect(check.used).toBe(2);
    expect(check.allowed).toBe(true);

    const over = await checkUsageLimit(user.id, 'AI_JOB_ANALYSIS', 9, 10);
    expect(over.allowed).toBe(false);
  });

  it('starts a fresh period next month', async () => {
    setTestNow(new Date('2026-03-15T00:00:00.000Z'));
    const user = await track(createUser());
    await consumeUsage(user.id, 'AI_JOB_ANALYSIS', 5, { limit: 100 });
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