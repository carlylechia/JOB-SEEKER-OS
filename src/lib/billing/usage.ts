/**
 * Generic usage accounting.
 *
 * ONE table backs every metered capability so a new AI feature never requires a
 * schema change. Usage is metered against EXPLICIT UTC PERIODS (periodStart /
 * periodEnd) rather than by deleting rows, which keeps history auditable and
 * makes the numbers defensible.
 *
 * CONCURRENCY: a naive "read count → check limit → write count" lets a user
 * bypass a limit by firing parallel requests. `consumeUsage` performs the check
 * and the increment inside a single transaction with a row lock held, so
 * simultaneous requests serialise.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { startOfUtcPeriod, endOfUtcPeriod, now } from './clock';
import type { FeatureKey } from './plans';
import { logImportantError } from '@/lib/observability';

export type UsageSummary = {
  feature: FeatureKey;
  used: number;
  limit: number | null;
  remaining: number | null;
  periodStart: Date;
  periodEnd: Date;
};

export class UsageLimitExceededError extends Error {
  readonly code = 'USAGE_LIMIT_EXCEEDED';
  readonly status = 403;
  readonly feature: FeatureKey;
  readonly used: number;
  readonly limit: number;

  constructor(feature: FeatureKey, used: number, limit: number) {
    super('You have reached the limit for this feature on your current plan.');
    this.name = 'UsageLimitExceededError';
    this.feature = feature;
    this.used = used;
    this.limit = limit;
  }

  toPayload() {
    return {
      error: {
        code: this.code,
        message: this.message,
        feature: this.feature,
        used: this.used,
        limit: this.limit,
      },
    };
  }
}

/** Total units consumed for a feature in the current UTC period. */
export async function getUsage(
  userId: string,
  feature: FeatureKey,
  at: Date = now(),
): Promise<number> {
  const periodStart = startOfUtcPeriod(at);
  const periodEnd = endOfUtcPeriod(at);

  const result = await prisma.usageRecord.aggregate({
    where: { userId, featureKey: feature, periodStart },
    _sum: { units: true },
  });

  return result._sum.units ?? 0;
}

/** Current-period usage against a limit. */
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

/** Would consuming `units` exceed the limit? */
export async function checkUsageLimit(
  userId: string,
  feature: FeatureKey,
  units = 1,
  limit: number | null,
  at: Date = now(),
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  if (limit === null) return { allowed: true, used: 0, limit: null };
  const used = await getUsage(userId, feature, at);
  return { allowed: used + units <= limit, used, limit };
}

/**
 * Atomically consume usage, enforcing the limit under concurrency.
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
 * (user, feature, period). The lock exists whether or not any row is present,
 * so concurrent consumers serialise correctly from the first request onward,
 * and it is released automatically on commit or rollback.
 *
 * Call this immediately BEFORE an expensive provider call, so a rejected
 * request never burns provider credits.
 */
export async function consumeUsage(
  userId: string,
  feature: FeatureKey,
  units = 1,
  options: { limit?: number | null; idempotencyKey?: string; at?: Date } = {},
): Promise<{ consumed: number; used: number }> {
  const at = options.at ?? now();
  const periodStart = startOfUtcPeriod(at);
  const limit = options.limit ?? null;

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Serialise all concurrent consumers for this user+feature+period.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${userId}),
            hashtext(${`${feature}:${periodStart.toISOString()}`})
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
            const used = await sumUsage(tx, userId, feature, periodStart);
            return { consumed: 0, used };
          }
        }

        const used = await sumUsage(tx, userId, feature, periodStart);

        if (limit !== null && used + units > limit) {
          // Throwing rolls the transaction back, so no usage is recorded.
          throw new UsageLimitExceededError(feature, used, limit);
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
      context: { feature, units },
    });
    throw error;
  }
}

async function sumUsage(
  tx: Prisma.TransactionClient,
  userId: string,
  feature: string,
  periodStart: Date,
): Promise<number> {
  const result = await tx.usageRecord.aggregate({
    where: { userId, featureKey: feature, periodStart },
    _sum: { units: true },
  });
  return result._sum.units ?? 0;
}

/**
 * Admin-facing usage rollup for a single user across all metered features.
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