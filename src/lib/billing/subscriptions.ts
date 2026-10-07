/**
 * Subscription service — the single source of truth for access state.
 *
 * Resolution order (the "source-of-truth hierarchy"):
 *
 *   session → user → subscription → trial/expiry evaluation → effective plan
 *          → entitlements → feature access
 *
 * CRITICAL: effective access is derived from real timestamps, never trusted
 * blindly from a stored `status`. A row saying ACTIVE with `endsAt < now` is
 * expired, immediately, regardless of whether the nightly cron has run. Cron
 * reconciles records and sends notifications; it is NOT the security boundary.
 */

import { prisma } from '@/lib/prisma';
import { now, addDays } from './clock';
import {
  PLAN_RANK,
  type PlanCode,
  type FeatureKey,
  FEATURE_ENTITLEMENTS,
  PLAN_LIMITS,
  type PlanLimitValue,
  getFeatureMeta,
  isFeatureKey,
} from './plans';
import { logImportantError, logImportantInfo } from '@/lib/observability';

export type SubscriptionRecord = {
  id: string;
  userId: string;
  planId: string;
  status: 'TRIALING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';
  startsAt: Date;
  endsAt: Date | null;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  source: 'TRIAL' | 'ADMIN_MANUAL' | 'FUTURE_BILLING' | 'SYSTEM';
  billingProvider: string | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  updatedByAdminId: string | null;
  adminNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  plan: { code: PlanCode; name: string; slug: string; description: string };
};

/**
 * The fully resolved answer to "what can this user do right now?".
 */
export type EffectiveSubscription = {
  userId: string;
  /** Plan code granting access. 'FREE' when no paid access is active. */
  plan: PlanCode;
  /** True when the user is an admin and bypasses all plan entitlements. */
  isAdmin: boolean;
  /** Stored status, reconciled against real dates. */
  status: 'TRIALING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED' | 'NONE';
  /** Trial is currently running (authoritative, from timestamps). */
  isTrialing: boolean;
  /** Trial exists but has elapsed. */
  trialExpired: boolean;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  /** Paid access window, if any. */
  startsAt: Date | null;
  endsAt: Date | null;
  /** True when paid access has an end date that has passed. */
  hasExpired: boolean;
  source: 'TRIAL' | 'ADMIN_MANUAL' | 'FUTURE_BILLING' | 'SYSTEM' | null;
  /** Whole days of trial left; 0 when not trialing. */
  trialDaysRemaining: number;
};

const DEFAULT_PLAN_CODE: PlanCode = 'FREE';

async function loadFreePlan() {
  const plan = await prisma.plan.findUnique({ where: { code: 'FREE' } });
  if (!plan) {
    throw new Error(
      'FREE plan is missing from the database. Run `npm run prisma:migrate:deploy` and re-seed plans.',
    );
  }
  return plan;
}

/**
 * Resolve effective access for a user.
 *
 * Admins receive unrestricted access regardless of plan or trial state, and
 * never consume customer quotas.
 */
export async function getEffectiveSubscription(userId: string): Promise<EffectiveSubscription> {
  const at = now();

  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    }),
    prisma.subscription.findUnique({
      where: { userId },
      include: { plan: { select: { code: true, name: true, slug: true, description: true } } },
    }),
  ]);

  if (!user) {
    return {
      userId,
      plan: DEFAULT_PLAN_CODE,
      isAdmin: false,
      status: 'NONE',
      isTrialing: false,
      trialExpired: false,
      trialStartsAt: null,
      trialEndsAt: null,
      startsAt: null,
      endsAt: null,
      hasExpired: false,
      source: null,
      trialDaysRemaining: 0,
    };
  }

  const isAdmin = user.role === 'ADMIN';

  // Admins are exempt from plan entitlements entirely.
  if (isAdmin) {
    return {
      userId,
      plan: 'PREMIUM',
      isAdmin: true,
      status: 'ACTIVE',
      isTrialing: subscription?.status === 'TRIALING',
      trialExpired: false,
      trialStartsAt: subscription?.trialStartsAt ?? null,
      trialEndsAt: subscription?.trialEndsAt ?? null,
      startsAt: subscription?.startsAt ?? null,
      endsAt: subscription?.endsAt ?? null,
      hasExpired: false,
      source: subscription?.source ?? null,
      trialDaysRemaining: 0,
    };
  }

  if (!subscription) {
    // No record yet (monetization not initialized for this user) → Free.
    return {
      userId,
      plan: DEFAULT_PLAN_CODE,
      isAdmin: false,
      status: 'NONE',
      isTrialing: false,
      trialExpired: false,
      trialStartsAt: null,
      trialEndsAt: null,
      startsAt: null,
      endsAt: null,
      hasExpired: false,
      source: null,
      trialDaysRemaining: 0,
    };
  }

  return resolveFromRecord(subscription, at);
}

/**
 * Pure resolution from a stored record + a point in time.
 * Exported so it can be unit-tested without a database.
 */
export function resolveFromRecord(
  subscription: SubscriptionRecord,
  at: Date,
): EffectiveSubscription {
  const base = {
    userId: subscription.userId,
    isAdmin: false,
    trialStartsAt: subscription.trialStartsAt,
    trialEndsAt: subscription.trialEndsAt,
    startsAt: subscription.startsAt,
    endsAt: subscription.endsAt,
    source: subscription.source,
  };

  // Suspension and cancellation revoke paid access immediately, but leave all
  // user data intact — suspension is not an account ban.
  if (subscription.status === 'SUSPENDED' || subscription.status === 'CANCELLED') {
    return {
      ...base,
      plan: DEFAULT_PLAN_CODE,
      status: subscription.status,
      isTrialing: false,
      trialExpired: false,
      hasExpired: false,
      trialDaysRemaining: 0,
    };
  }

  const trialStarted = Boolean(subscription.trialStartsAt && subscription.trialStartsAt <= at);
  const trialEnds = subscription.trialEndsAt;
  const trialActive = trialStarted && Boolean(trialEnds && trialEnds > at);

  if (trialActive && subscription.plan.code !== 'FREE') {
    const remaining = Math.max(
      0,
      Math.floor((trialEnds!.getTime() - at.getTime()) / (24 * 60 * 60 * 1000)),
    );
    return {
      ...base,
      plan: subscription.plan.code,
      status: 'TRIALING',
      isTrialing: true,
      // Trial expiry is only "expired" once a paid window isn't keeping access alive.
      trialExpired: false,
      hasExpired: false,
      trialDaysRemaining: remaining,
    };
  }

  // Trial elapsed — but a paid window may still be active (admin converted the
  // trial to paid, or extended access). Paid wins when it is genuinely active.
  const trialExpired = trialStarted && Boolean(trialEnds && trialEnds <= at);

  const paidStartOk = subscription.startsAt <= at;
  const paidEndOk = subscription.endsAt === null || subscription.endsAt > at;

  if (subscription.status === 'ACTIVE' && subscription.plan.code !== 'FREE' && paidStartOk && paidEndOk) {
    return {
      ...base,
      plan: subscription.plan.code,
      status: 'ACTIVE',
      isTrialing: false,
      trialExpired,
      hasExpired: false,
      trialDaysRemaining: 0,
    };
  }

  // Explicitly stored EXPIRED, or a paid window that has elapsed → Free.
  // Access is revoked by timestamp, not by the cron job.
  return {
    ...base,
    plan: DEFAULT_PLAN_CODE,
    status: subscription.status === 'EXPIRED' ? 'EXPIRED' : 'EXPIRED',
    isTrialing: false,
    trialExpired,
    hasExpired: true,
    trialDaysRemaining: 0,
  };
}

/** Effective plan code only. */
export async function getEffectivePlan(userId: string): Promise<PlanCode> {
  return (await getEffectiveSubscription(userId)).plan;
}

/**
 * Start a trial for a user.
 *
 * IDEMPOTENT BY DESIGN: if a trial already exists it is returned untouched.
 * A user must never receive a second trial because they logged out, verified
 * their email, completed onboarding, or because a scheduled job ran again.
 */
export async function startTrial(params: {
  userId: string;
  trialStartsAt: Date;
  trialDays?: number;
  planCode?: PlanCode;
  /** Optional external correlation id for observability. */
  sourceNote?: string;
}): Promise<{ created: boolean; subscription: EffectiveSubscription }> {
  const { userId, trialStartsAt, planCode = 'PRO' } = params;
  const trialDays = params.trialDays ?? 14;
  const trialEndsAt = addDays(trialStartsAt, trialDays);

  const existing = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  });

  if (existing) {
    // Never restart or overwrite an existing trial.
    if (existing.trialStartsAt) {
      const effective = await getEffectiveSubscription(userId);
      return { created: false, subscription: effective };
    }
  }

  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan) throw new Error(`Plan ${planCode} is missing from the database.`);

  await prisma.$transaction(async (tx) => {
    await tx.subscription.upsert({
      where: { userId },
      update: {
        planId: plan.id,
        status: 'TRIALING',
        startsAt: trialStartsAt,
        endsAt: null,
        trialStartsAt,
        trialEndsAt,
        source: 'TRIAL',
        updatedByAdminId: null,
        adminNote: null,
      },
      create: {
        userId,
        planId: plan.id,
        status: 'TRIALING',
        startsAt: trialStartsAt,
        endsAt: null,
        trialStartsAt,
        trialEndsAt,
        source: 'TRIAL',
      },
    });

    await tx.subscriptionEvent.create({
      data: {
        userId,
        type: 'TRIAL_STARTED',
        newPlanCode: plan.code,
        newStatus: 'TRIALING',
        newStartsAt: trialStartsAt,
        newTrialEndsAt: trialEndsAt,
        previousTrialStartsAt: trialStartsAt,
        reason: params.sourceNote ?? 'Trial started',
      },
    });
  });

  await logImportantInfo({
    event: 'trial_initialized',
    userId,
    context: { planCode, trialStartsAt: trialStartsAt.toISOString(), trialEndsAt: trialEndsAt.toISOString() },
  });

  const effective = await getEffectiveSubscription(userId);
  return { created: true, subscription: effective };
}

/**
 * Mark a trial as expired for a user whose trial window has elapsed.
 *
 * Idempotent: a user whose trial is not due is skipped, and an already-expired
 * subscription is left alone, so running this repeatedly is safe.
 */
export async function expireTrialIfDue(
  userId: string,
  at: Date = now(),
): Promise<{ expired: boolean }> {
  const existing = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  });

  if (!existing || !existing.trialEndsAt || existing.trialEndsAt > at) {
    return { expired: false };
  }
  if (existing.status === 'EXPIRED') return { expired: false };

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { userId },
      data: { status: 'EXPIRED' },
    });
    await tx.subscriptionEvent.create({
      data: {
        userId,
        type: 'TRIAL_EXPIRED',
        previousPlanCode: existing.plan.code,
        previousStatus: existing.status,
        newPlanCode: 'FREE',
        newStatus: 'EXPIRED',
        reason: 'Trial window elapsed',
      },
    });
  });

  await logImportantInfo({
    event: 'trial_expired',
    userId,
    context: { previousPlan: existing.plan.code, trialEndsAt: existing.trialEndsAt.toISOString() },
  });

  return { expired: true };
}

/**
 * Reconcile subscription rows whose paid window has elapsed.
 *
 * This is bookkeeping + notification only. Effective access already reverted
 * to Free the moment the timestamp passed (see `resolveFromRecord`).
 * Bounded to `batchSize` so a large user base cannot exhaust a serverless
 * invocation.
 */
export async function reconcileExpiredSubscriptions(
  batchSize = 200,
  at: Date = now(),
): Promise<{ checked: number; expired: number; failed: number }> {
  const stale = await prisma.subscription.findMany({
    where: {
      NOT: { status: 'EXPIRED' },
      OR: [
        { endsAt: { not: null, lte: at } },
        {
          status: 'TRIALING',
          trialEndsAt: { not: null, lte: at },
        },
      ],
    },
    select: { userId: true, status: true, planId: true },
    take: batchSize,
    orderBy: { updatedAt: 'asc' },
  });

  let expired = 0;
  let failed = 0;

  for (const row of stale) {
    try {
      const result = await expireTrialIfDue(row.userId, at);
      if (result.expired) expired++;
    } catch (error) {
      // Never abort the whole batch on one bad record.
      failed++;
      await logImportantError({
        event: 'subscription_reconciliation_failed',
        userId: row.userId,
        error,
      });
    }
  }

  return { checked: stale.length, expired, failed };
}

/**
 * Feature access for a user, resolved once.
 */
export type Entitlement = {
  userId: string;
  plan: PlanCode;
  isAdmin: boolean;
  isTrialing: boolean;
  features: Record<FeatureKey, boolean>;
  limits: { jobs: PlanLimitValue; resumes: PlanLimitValue; aiCredits: PlanLimitValue };
};

/** Compute entitlements from an already-resolved subscription (no extra query). */
export function buildEntitlements(effective: EffectiveSubscription): Entitlement {
  const features = {} as Record<FeatureKey, boolean>;
  for (const [key, meta] of Object.entries(FEATURE_ENTITLEMENTS)) {
    const featureKey = key as FeatureKey;
    // Admins bypass the plan table entirely.
    features[featureKey] = effective.isAdmin || meta.plans.includes(effective.plan);
  }

  return {
    userId: effective.userId,
    plan: effective.plan,
    isAdmin: effective.isAdmin,
    isTrialing: effective.isTrialing,
    features,
    limits: PLAN_LIMITS[effective.plan],
  };
}

/** Resolve entitlements for a user. */
export async function getEntitlements(userId: string): Promise<Entitlement> {
  return buildEntitlements(await getEffectiveSubscription(userId));
}

/**
 * Server-side feature gate. THIS is the authoritative check — the UI gate is
 * cosmetic and can always be bypassed by calling the API directly.
 */
export async function hasEntitlement(userId: string, feature: FeatureKey): Promise<boolean> {
  const entitlements = await getEntitlements(userId);
  return entitlements.features[feature];
}

export class PlanRequiredError extends Error {
  readonly code = 'PLAN_REQUIRED';
  readonly status = 403;
  readonly feature: FeatureKey;
  readonly requiredPlan: PlanCode;

  constructor(feature: FeatureKey, requiredPlan: PlanCode) {
    super('This feature requires a paid plan.');
    this.name = 'PlanRequiredError';
    this.feature = feature;
    this.requiredPlan = requiredPlan;
  }

  /** Safe metadata for clients — no internal implementation details. */
  toPayload() {
    return {
      error: {
        code: this.code,
        message: this.message,
        feature: this.feature,
        requiredPlan: this.requiredPlan,
      },
    };
  }
}

/**
 * Throw `PlanRequiredError` unless the user has the feature.
 * Call this immediately before any expensive provider call.
 */
export async function requireEntitlement(userId: string, feature: FeatureKey): Promise<Entitlement> {
  const entitlements = await getEntitlements(userId);
  // An unknown feature key must fail closed rather than crash on a lookup.
  if (!entitlements.features[feature]) {
    const required = requiredPlanFor(feature);
    await logImportantInfo({
      event: 'billing_access_denied',
      userId,
      context: { feature, plan: entitlements.plan, unknownFeature: !isFeatureKey(feature) },
    });
    throw new PlanRequiredError(feature, required);
  }
  return entitlements;
}

/**
 * Lowest plan that grants a feature, for "Available with Pro" copy.
 * Defaults to PRO for an unmapped key so the gate still fails closed.
 */
export function requiredPlanFor(feature: string): PlanCode {
  const meta = getFeatureMeta(feature);
  if (!meta) return 'PRO';
  const plans = meta.plans;
  return plans.reduce((lowest, plan) =>
    PLAN_RANK[plan] < PLAN_RANK[lowest] ? plan : lowest,
  );
}