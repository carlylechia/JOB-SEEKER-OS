/**
 * Generic usage accounting.
 *
 * ONE table backs every metered capability so a new AI feature never requires a
 * schema change. Usage is metered against EXPLICIT UTC PERIODS (periodStart /
 * periodEnd) rather than by deleting rows, which keeps history auditable and
 * makes the numbers defensible.
 *
 * ── Allowance is per POOL, not per feature ──────────────────────────────────
 *
 * A row records WHICH feature was used (`featureKey`), but the balance is
 * checked and drawn from a shared POOL. For AI work that pool is `AI`, and its
 * size is `PLAN_LIMITS[*].aiCredits`.
 *
 * This distinction matters commercially. Summing per feature meant a Free user
 * with an allowance of 25 could run 25 resume analyses AND 25 job analyses AND
 * 25 resume optimisations in a month — three times the allowance they were sold,
 * and a figure that grew every time another metered feature shipped. One shared
 * pool matches what the plan copy promises and makes the allowance mean what it
 * says. `FEATURE_ENTITLEMENTS[feature].usagePool` declares which pool a feature
 * spends from, so the decision is forced at the point a feature is added rather
 * than discovered afterwards.
 *
 * ── Concurrency ────────────────────────────────────────────────────────────
 *
 * A naive "read count → check limit → write count" lets a user bypass a limit by
 * firing parallel requests. `consumeUsage` performs the check and the increment
 * inside a single transaction holding a PostgreSQL transaction-scoped ADVISORY
 * LOCK keyed on `(user, pool, period)`.
 *
 * The lock is keyed on the POOL, not the feature. Keying it on the feature would
 * leave two parallel requests to two different AI features unsynchronised: each
 * would see the pre-transaction total, each would pass, and together they would
 * overshoot. The pool key is what makes one balance behave like one balance.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { startOfUtcPeriod, endOfUtcPeriod, now } from './clock';
import {
  FEATURE_ENTITLEMENTS,
  isUsagePool,
  type FeatureKey,
  type UsagePool,
} from './plans';
import { logImportantError } from '@/lib/observability';

export type UsageSummary = {
  feature: FeatureKey;
  used: number;
  limit: number | null;
  remaining: number | null;
  periodStart: Date;
  periodEnd: Date;
};

/**
 * The state of one shared allowance.
 *
 * `byFeature` is the per-feature breakdown of the SAME total. It exists so an
 * interface can say "12 of 25 AI credits left — 9 job analyses" instead of
 * showing the plan's ceiling as though it were a balance, and so an admin can see
 * which capability a user is actually spending on.
 */
export type PoolUsageSummary = {
  pool: UsagePool;
  used: number;
  limit: number | null;
  remaining: number | null;
  periodStart: Date;
  periodEnd: Date;
  byFeature: Array<{ feature: FeatureKey; used: number }>;
};

export class UsageLimitExceededError extends Error {
  readonly code = 'USAGE_LIMIT_EXCEEDED';
  readonly status = 403;
  /** The feature the caller was attempting, for a precise message. */
  readonly feature: FeatureKey;
  /** The shared pool the allowance belongs to. */
  readonly pool: UsagePool;
  readonly used: number;
  readonly limit: number;

  constructor(feature: FeatureKey, pool: UsagePool, used: number, limit: number) {
    super('You have used all of the AI allowance included in your plan this month.');
    this.name = 'UsageLimitExceededError';
    this.feature = feature;
    this.pool = pool;
    this.used = used;
    this.limit = limit;
  }

  toPayload() {
    return {
      error: {
        code: this.code,
        message: this.message,
        feature: this.feature,
        pool: this.pool,
        used: this.used,
        limit: this.limit,
      },
    };
  }
}

/** Every feature key that draws on a given pool, from the central registry. */
export function featuresInPool(pool: UsagePool): FeatureKey[] {
  return (Object.keys(FEATURE_ENTITLEMENTS) as FeatureKey[]).filter(
    (feature) => FEATURE_ENTITLEMENTS[feature].usagePool === pool,
  );
}

/** The pool a feature spends from, or `null` when it is not metered. */
export function poolForFeature(feature: FeatureKey): UsagePool | null {
  return FEATURE_ENTITLEMENTS[feature]?.usagePool ?? null;
}

/** Total units consumed for one feature in the current UTC period. */
export async function getUsage(
  userId: string,
  feature: FeatureKey,
  at: Date = now(),
): Promise<number> {
  const result = await prisma.usageRecord.aggregate({
    where: { userId, featureKey: feature, periodStart: startOfUtcPeriod(at) },
    _sum: { units: true },
  });

  return result._sum.units ?? 0;
}

/**
 * Total units consumed across a whole pool in the current UTC period.
 *
 * This is the number a limit is checked against.
 */
export async function getPoolUsage(
  userId: string,
  pool: UsagePool,
  at: Date = now(),
): Promise<number> {
  return sumPoolUsage(prisma, userId, pool, startOfUtcPeriod(at));
}

/** Current-period usage of one feature against a limit. */
export async function getUsageSummary(
  userId: string,
  feature: FeatureKey,
  limit: number | null,
  at: Date = now(),
): Promise<UsageSummary> {
  const used = await getUsage(userId, feature, at);
  return {
    feature,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    periodStart: startOfUtcPeriod(at),
    periodEnd: endOfUtcPeriod(at),
  };
}

/**
 * Current state of a shared allowance, with the per-feature breakdown of it.
 *
 * This is what an interface should read. `getUsageSummary` remains available for
 * a genuinely per-feature question, but it must never be used to decide whether
 * a user has met a limit.
 */
export async function getPoolUsageSummary(
  userId: string,
  pool: UsagePool,
  limit: number | null,
  at: Date = now(),
): Promise<PoolUsageSummary> {
  const periodStart = startOfUtcPeriod(at);
  const [used, grouped] = await Promise.all([
    sumPoolUsage(prisma, userId, pool, periodStart),
    prisma.usageRecord.groupBy({
      by: ['featureKey'],
      where: { userId, periodStart, featureKey: { in: featuresInPool(pool) } },
      _sum: { units: true },
    }),
  ]);

  return {
    pool,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    periodStart,
    periodEnd: endOfUtcPeriod(at),
    byFeature: grouped
      .map((row) => ({ feature: row.featureKey as FeatureKey, used: row._sum.units ?? 0 }))
      .sort((a, b) => b.used - a.used || a.feature.localeCompare(b.feature)),
  };
}

/** Would consuming `units` exceed a pool's limit? */
export async function checkUsageLimit(
  userId: string,
  pool: UsagePool,
  units = 1,
  limit: number | null,
  at: Date = now(),
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  if (limit === null) return { allowed: true, used: 0, limit: null };
  const used = await getPoolUsage(userId, pool, at);
  return { allowed: used + units <= limit, used, limit };
}

type Sql = Prisma.TransactionClient | typeof prisma;

async function sumPoolUsage(
  sql: Sql,
  userId: string,
  pool: UsagePool,
  periodStart: Date,
): Promise<number> {
  const result = await sql.usageRecord.aggregate({
    where: { userId, periodStart, featureKey: { in: featuresInPool(pool) } },
    _sum: { units: true },
  });
  return result._sum.units ?? 0;
}

/**
 * Atomically consume usage from a shared pool, enforcing the limit under
 * concurrency.
 *
 * `pool` is REQUIRED rather than defaulted. Defaulting it would mean a new
 * metered feature silently joined the AI allowance because nobody passed the
 * argument — which is exactly the class of mistake this function's pool keying
 * exists to prevent.
 *
 * CONCURRENCY: a naive "read count → check limit → write count" lets a user
 * bypass a limit by firing parallel requests.
 *
 * `SELECT … FOR UPDATE` is NOT sufficient on its own: it only locks rows that
 * already exist, so the very first burst of requests in an empty period would
 * each read zero and all pass the check. (A test caught exactly this — 6 of 10
 * parallel requests passed a limit of 5.)
 *
 * Instead this takes a PostgreSQL TRANSACTION-SCOPED ADVISORY LOCK keyed on
 * (user, POOL, period). The lock exists whether or not any row is present, so
 * concurrent consumers serialise correctly from the first request onward, and it
 * is released automatically on commit or rollback.
 *
 * Call this immediately BEFORE an expensive provider call, so a rejected request
 * never burns provider credits.
 */
export async function consumeUsage(
  userId: string,
  feature: FeatureKey,
  units: number,
  options: { pool: UsagePool; limit?: number | null; idempotencyKey?: string; at?: Date },
): Promise<{ consumed: number; used: number }> {
  const at = options.at ?? now();
  const periodStart = startOfUtcPeriod(at);
  const limit = options.limit ?? null;
  const pool = options.pool;

  // The feature must actually belong to the pool it claims. A mismatch would
  // write a row the pool's own balance never counts — usage that is charged to
  // nobody and enforced against nobody.
  if (!isUsagePool(pool) || poolForFeature(feature) !== pool) {
    await logImportantError({
      event: 'usage_pool_mismatch',
      userId,
      context: { feature, pool },
    });
    throw new Error(`Feature ${feature} does not draw on usage pool ${pool}.`);
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Serialise all concurrent consumers of this user's allowance for this
        // pool. Keyed on the POOL, so two different AI features contend with
        // each other rather than each seeing a stale total.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${userId}),
            hashtext(${`${pool}:${periodStart.toISOString()}`})
          )
        `;

        if (options.idempotencyKey) {
          const duplicate = await tx.usageRecord.findFirst({
            where: {
              userId,
              featureKey: feature,
              periodStart,
              idempotencyKey: options.idempotencyKey,
            },
            select: { units: true },
          });
          // Already charged for this exact operation — do not double-count.
          if (duplicate) {
            const used = await sumPoolUsage(tx, userId, pool, periodStart);
            return { consumed: 0, used };
          }
        }

        const used = await sumPoolUsage(tx, userId, pool, periodStart);

        if (limit !== null && used + units > limit) {
          // Throwing rolls the transaction back, so no usage is recorded.
          throw new UsageLimitExceededError(feature, pool, used, limit);
        }

        await tx.usageRecord.create({
          data: {
            userId,
            featureKey: feature,
            units,
            periodStart,
            periodEnd: endOfUtcPeriod(at),
            idempotencyKey: options.idempotencyKey ?? null,
          },
        });

        return { consumed: units, used: used + units };
      },
      // Bound how long we hold the lock. Under contention the queue must still
      // drain rather than failing with a lock timeout.
      { timeout: 15_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof UsageLimitExceededError) throw error;

    await logImportantError({
      event: 'usage_consume_failed',
      userId,
      error,
      context: { feature, pool, units },
    });
    throw error;
  }
}

/**
 * Admin-facing usage rollup for a single user across all metered features.
 *
 * Every row in the table, regardless of pool — this is a reconciliation view,
 * not an allowance calculation, so it deliberately does not apply any limit.
 */
export async function getUserUsageBreakdown(
  userId: string,
  at: Date = now(),
): Promise<Array<{ feature: string; units: number }>> {
  const periodStart = startOfUtcPeriod(at);
  const grouped = await prisma.usageRecord.groupBy({
    by: ['featureKey'],
    where: { userId, periodStart },
    _sum: { units: true },
  });

  return grouped.map((row) => ({
    feature: row.featureKey,
    units: row._sum.units ?? 0,
  }));
}