/**
 * Monetization activation + deterministic trial initialization.
 *
 * THE CENTRAL INVARIANT: existing users all receive the SAME 14-day Pro trial
 * window, anchored to ONE immutable launch timestamp stored in the database.
 *
 * Trials must never start on:
 *   next login, migration time, onboarding completion, first dashboard visit,
 *   email verification, or any other per-user "first activity" signal.
 *
 * That is why the launch timestamp is persisted in `MonetizationConfig` and
 * never recomputed. Running initialization twice does not move the window.
 */

import { prisma } from '@/lib/prisma';
import { now, addDays } from './clock';
import { startTrial, getEffectiveSubscription } from './subscriptions';
import { enqueueEmailBestEffort } from './email-outbox';
import { logImportantError, logImportantInfo } from '@/lib/observability';

const CONFIG_ID = 'global';

/** Trial length for new users. Configurable; production default is 14 days. */
export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_TRIAL_PLAN = 'PRO' as const;

export type MonetizationConfigRow = {
  id: string;
  enabledAt: Date | null;
  existingUserTrialStartedAt: Date | null;
  existingUserTrialEndsAt: Date | null;
  trialDays: number;
  trialPlan: 'FREE' | 'PRO' | 'PREMIUM';
  initializedAt: Date | null;
};

/** Read the singleton config, creating it if absent. */
export async function getMonetizationConfig(): Promise<MonetizationConfigRow> {
  const existing = await prisma.monetizationConfig.findUnique({ where: { id: CONFIG_ID } });
  if (existing) return existing;

  return prisma.monetizationConfig.create({
    data: {
      id: CONFIG_ID,
      trialDays: DEFAULT_TRIAL_DAYS,
      trialPlan: DEFAULT_TRIAL_PLAN,
    },
  });
}

/**
 * Is monetization live?
 *
 * Requires BOTH a config row and an explicit activation timestamp, so code can
 * be deployed and migrations applied without trials starting early.
 */
export async function isMonetizationEnabled(): Promise<boolean> {
  // Server-side kill switch for emergencies.
  if (process.env.MONETIZATION_ENABLED === 'false') return false;

  const config = await getMonetizationConfig();
  return config.enabledAt !== null;
}

/**
 * Start the trial for a user who registered AFTER monetization went live.
 *
 * Idempotent: an existing trial is never restarted, so logging in, verifying
 * email, or completing onboarding can never grant extra trial time.
 */
export async function maybeStartTrialForNewUser(userId: string): Promise<void> {
  if (!(await isMonetizationEnabled())) return;

  const config = await getMonetizationConfig();
  const trialDays = process.env.NODE_ENV === 'production' ? config.trialDays : trialDaysFromEnv(config.trialDays);

  const { subscription, created } = await startTrial({
    userId,
    // The trial begins at account creation, not at first login.
    trialStartsAt: now(),
    trialDays,
    planCode: config.trialPlan,
    sourceNote: 'New user trial',
  });

  if (!created) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (user?.email && subscription.trialEndsAt) {
    await enqueueEmailBestEffort({
      type: 'trial_started',
      recipient: user.email,
      payload: { trialEndsAt: subscription.trialEndsAt.toISOString() },
      idempotencyKey: `trial-started:${userId}`,
    });
  }
}

/**
 * Development-only trial shortening.
 *
 * Refuses to do anything in production so a stray env var can never alter real
 * billing behaviour.
 */
function trialDaysFromEnv(productionDays: number): number {
  if (process.env.NODE_ENV === 'production') return productionDays;
  const raw = process.env.DEV_TRIAL_DAYS;
  if (!raw) return productionDays;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 365) return productionDays;
  return parsed;
}

/**
 * One-time, idempotent monetization initialization.
 *
 * Behaviour:
 *   1. creates the config if missing
 *   2. establishes ONE immutable launch timestamp (never moved on re-run)
 *   3. derives the 14-day existing-user trial window from that timestamp
 *   4. gives every eligible existing user the same Pro trial
 *   5. never overwrites an admin-managed paid plan
 *   6. never creates duplicate subscriptions
 *   7. never restarts a trial on re-run
 *
 * Batched and resumable: safe to run against a large user base.
 */
export async function initializeMonetization(options?: {
  /** Overrides the launch timestamp. Only set this on FIRST run. */
  launchAt?: Date;
  activate?: boolean;
  batchSize?: number;
}): Promise<{
  alreadyInitialized: boolean;
  launchAt: Date;
  trialEndsAt: Date;
  usersExamined: number;
  trialsCreated: number;
  trialsSkipped: number;
  adminsSkipped: number;
  failed: number;
}> {
  const batchSize = options?.batchSize ?? 500;
  const activate = options?.activate ?? true;

  const config = await getMonetizationConfig();

  // The launch timestamp is IMMUTABLE. Re-running must not move the window.
  const alreadyInitialized = config.existingUserTrialStartedAt !== null;
  const launchAt = alreadyInitialized
    ? (config.existingUserTrialStartedAt as Date)
    : (options?.launchAt ?? now());

  const trialDays = config.trialDays;
  const trialEndsAt = config.existingUserTrialEndsAt ?? addDays(launchAt, trialDays);

  await prisma.monetizationConfig.update({
    where: { id: CONFIG_ID },
    data: {
      existingUserTrialStartedAt: launchAt,
      existingUserTrialEndsAt: trialEndsAt,
      trialDays,
      trialPlan: config.trialPlan,
      ...(activate ? { enabledAt: config.enabledAt ?? launchAt } : {}),
      ...(alreadyInitialized ? {} : { initializedAt: now() }),
    },
  });

  let cursor: string | undefined;
  let usersExamined = 0;
  let trialsCreated = 0;
  let trialsSkipped = 0;
  let adminsSkipped = 0;
  let failed = 0;

  // Paginate by cursor so memory stays bounded regardless of user count.
  for (;;) {
    const users = await prisma.user.findMany({
      select: { id: true, role: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (users.length === 0) break;

    for (const user of users) {
      usersExamined++;

      // Admins are exempt from customer entitlements entirely.
      if (user.role === 'ADMIN') {
        adminsSkipped++;
        continue;
      }

      try {
        // Skip anyone who already has a record — never overwrite an existing
        // explicit/admin-managed paid plan, and never create a duplicate.
        const existing = await prisma.subscription.findUnique({
          where: { userId: user.id },
          select: { id: true, planId: true, source: true },
        });

        if (existing) {
          // Only backfill a record that has no trial yet (e.g. a user who
          // registered after the schema change but before activation).
          const hasTrial = await prisma.subscriptionEvent.findFirst({
            where: { userId: user.id, type: 'TRIAL_STARTED' },
            select: { id: true },
          });

          if (hasTrial) {
            trialsSkipped++;
            continue;
          }

          // Existing paid/admin-managed plan → leave it alone.
          const plan = await prisma.plan.findUnique({
            where: { id: existing.planId },
            select: { code: true },
          });

          if (existing.source === 'ADMIN_MANUAL' || (plan && plan.code !== 'FREE')) {
            trialsSkipped++;
            continue;
          }
        }

        const { created } = await startTrial({
          userId: user.id,
          // The EXISTING-USER trial starts at launch for every user alike.
          trialStartsAt: launchAt,
          trialDays,
          planCode: config.trialPlan,
          sourceNote: 'Existing user trial at monetization launch',
        });

        if (created) trialsCreated++;
        else trialsSkipped++;
      } catch (error) {
        failed++;
        await logImportantError({
          event: 'trial_initialization_failed',
          userId: user.id,
          error,
        });
      }
    }

    cursor = users[users.length - 1].id;
    if (users.length < batchSize) break;
  }

  await logImportantInfo({
    event: 'monetization_initialized',
    context: {
      launchAt: launchAt.toISOString(),
      trialEndsAt: trialEndsAt.toISOString(),
      trialDays,
      trialPlan: config.trialPlan,
      alreadyInitialized,
      usersExamined,
      trialsCreated,
      trialsSkipped,
      adminsSkipped,
      failed,
    },
  });

  return {
    alreadyInitialized,
    launchAt,
    trialEndsAt,
    usersExamined,
    trialsCreated,
    trialsSkipped,
    adminsSkipped,
    failed,
  };
}

/** User-facing subscription view. Never exposes admin notes or audit internals. */
export async function getUserBillingSummary(userId: string) {
  const effective = await getEffectiveSubscription(userId);

  const [pendingRequest, lastRequest] = await Promise.all([
    prisma.upgradeRequest.findFirst({
      where: { userId, status: { in: ['PENDING', 'CONTACTED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, requestedPlan: true, createdAt: true },
    }),
    prisma.upgradeRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, requestedPlan: true, createdAt: true, resolvedAt: true },
    }),
  ]);

  return {
    plan: effective.plan,
    status: effective.status,
    isAdmin: effective.isAdmin,
    isTrialing: effective.isTrialing,
    trialExpired: effective.trialExpired,
    trialStartsAt: effective.trialStartsAt,
    trialEndsAt: effective.trialEndsAt,
    trialDaysRemaining: effective.trialDaysRemaining,
    startsAt: effective.startsAt,
    endsAt: effective.endsAt,
    hasExpired: effective.hasExpired,
    openRequest: pendingRequest,
    latestRequest: lastRequest,
  };
}