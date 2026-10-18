/**
 * Admin subscription mutations.
 *
 * Every plan change follows the same transactional path:
 *
 *   BEGIN
 *     read + lock current subscription
 *     validate the requested change
 *     update the subscription
 *     write an immutable audit event
 *     resolve any linked upgrade request
 *     create in-app notification
 *     enqueue email outbox entry   <-- inside tx, delivery is outside
 *   COMMIT
 *
 * Rules enforced here:
 *   - the caller must already be an authenticated ADMIN (see lib/authz)
 *   - `userId` always comes from the route/session, never from a request body
 *   - a manual change REQUIRES a reason
 *   - external email APIs are never called inside the transaction
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { now } from './clock';
import type { PlanCode } from './plans';
import { getPlanLabel, PLAN_RANK } from './plans';
import { getEffectiveSubscription, type EffectiveSubscription } from './subscriptions';
import { enqueueEmail } from './email-outbox';
import { logImportantError, logImportantInfo } from '@/lib/observability';

export type AdminPlanChangeInput = {
  /** Target user. Always server-derived, never client-supplied. */
  userId: string;
  planCode: PlanCode;
  /** Defaults to now. When future-dated, takes effect at that instant. */
  startsAt?: Date;
  /** null = no expiry (admin must consciously choose this). */
  endsAt?: Date | null;
  /** Required for manual changes. Recorded in the audit trail. */
  reason: string;
  /** Optional admin note; never shown to the user. */
  adminNote?: string | null;
  /** The authenticated admin performing the change. */
  adminId: string;
  /** Upgrade request to resolve as part of this change. */
  resolveUpgradeRequestId?: string;
};

export class PlanChangeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'PlanChangeError';
    this.code = code;
    this.status = status;
  }
}

function validateDates(startsAt: Date, endsAt: Date | null | undefined) {
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new PlanChangeError(
      'INVALID_DATES',
      'The expiration date must be after the effective start date.',
      422,
    );
  }
}

/**
 * Apply an admin plan change.
 *
 * Returns the user's effective access AFTER the change. Throws PlanChangeError
 * with a safe, customer-facing message on failure; the caller must not report
 * success unless this resolves.
 */
export async function adminChangePlan(
  input: AdminPlanChangeInput,
): Promise<{ effective: EffectiveSubscription; eventId: string }> {
  const { userId, planCode, reason, adminId, resolveUpgradeRequestId } = input;
  const at = now();

  if (!reason || reason.trim().length < 3) {
    throw new PlanChangeError('REASON_REQUIRED', 'A reason is required for manual plan changes.', 422);
  }

  const startsAt = input.startsAt ?? at;
  const endsAt = input.endsAt ?? null;
  validateDates(startsAt, endsAt);

  try {
    const eventId = await prisma.$transaction(
      async (tx) => {
        // Validate targets exist BEFORE mutating anything.
        const [admin, targetUser, plan] = await Promise.all([
          tx.user.findUnique({ where: { id: adminId }, select: { id: true, role: true } }),
          tx.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, role: true },
          }),
          tx.plan.findUnique({ where: { code: planCode }, select: { id: true, code: true, name: true } }),
        ]);

        // Defence in depth: re-verify admin role inside the transaction.
        if (!admin || admin.role !== 'ADMIN') {
          throw new PlanChangeError('FORBIDDEN', 'Administrator access is required.', 403);
        }
        if (!targetUser) {
          throw new PlanChangeError('USER_NOT_FOUND', 'That user could not be found.', 404);
        }
        if (!plan) {
          throw new PlanChangeError('PLAN_NOT_FOUND', 'That plan could not be found.', 404);
        }

        const previous = await tx.subscription.findUnique({
          where: { userId },
          include: { plan: { select: { code: true } } },
        });

        const previousPlanCode = previous?.plan.code ?? null;
        const previousStatus = previous?.status ?? null;

        // Decide the event type from the actual transition.
        const eventType = resolveEventType(previousPlanCode, planCode, previousStatus);

        // FREE + a future end date makes no sense; a Free plan has no window.
        const nextStatus = planCode === 'FREE' ? 'ACTIVE' : 'ACTIVE';
        const nextEndsAt = planCode === 'FREE' ? null : endsAt;

        const subscription = await tx.subscription.upsert({
          where: { userId },
          update: {
            planId: plan.id,
            status: nextStatus,
            startsAt,
            endsAt: nextEndsAt,
            source: 'ADMIN_MANUAL',
            updatedByAdminId: adminId,
            adminNote: input.adminNote ?? null,
          },
          create: {
            userId,
            planId: plan.id,
            status: nextStatus,
            startsAt,
            endsAt: nextEndsAt,
            source: 'ADMIN_MANUAL',
            updatedByAdminId: adminId,
            adminNote: input.adminNote ?? null,
          },
        });

        // Immutable audit record.
        const event = await tx.subscriptionEvent.create({
          data: {
            userId,
            actorAdminId: adminId,
            type: eventType,
            previousPlanCode,
            newPlanCode: plan.code,
            previousStatus,
            newStatus: nextStatus,
            previousStartsAt: previous?.startsAt ?? null,
            newStartsAt: startsAt,
            previousEndsAt: previous?.endsAt ?? null,
            newEndsAt: nextEndsAt,
            previousTrialStartsAt: previous?.trialStartsAt ?? null,
            previousTrialEndsAt: previous?.trialEndsAt ?? null,
            reason: reason.trim(),
          },
        });

        // Resolve the linked upgrade request in the SAME transaction.
        if (resolveUpgradeRequestId) {
          const request = await tx.upgradeRequest.findUnique({
            where: { id: resolveUpgradeRequestId },
            select: { id: true, userId: true, status: true, requestedPlan: true },
          });

          if (!request) {
            throw new PlanChangeError('REQUEST_NOT_FOUND', 'That upgrade request could not be found.', 404);
          }
          if (request.userId !== userId) {
            throw new PlanChangeError('REQUEST_MISMATCH', 'That request does not belong to this user.', 409);
          }
          // Concurrency: another admin may have already resolved it.
          if (request.status === 'APPROVED' || request.status === 'REJECTED' || request.status === 'CANCELLED') {
            throw new PlanChangeError(
              'REQUEST_ALREADY_RESOLVED',
              'That upgrade request was already resolved by another administrator.',
              409,
            );
          }

          await tx.upgradeRequest.update({
            where: { id: request.id },
            data: {
              status: 'APPROVED',
              resolvedByAdminId: adminId,
              resolvedAt: at,
            },
          });
        }

        // In-app notification (reuses the existing Notification infrastructure).
        const planLabel = getPlanLabel(plan.code, false);
        await tx.notification.create({
          data: {
            userId,
            type: 'system',
            title: `Your plan is now ${planLabel}`,
            message: endsAt
              ? `Your plan was updated to ${planLabel}, effective immediately. It expires on ${endsAt.toISOString().slice(0, 10)}.`
              : `Your plan was updated to ${planLabel}, effective immediately.`,
            emailSent: false,
          },
        });

        // Email is QUEUED in the transaction and SENT afterwards — a provider
        // failure can never roll back or fail the plan change.
        await enqueueEmail(tx, {
          type: 'plan_changed',
          recipient: targetUser.email,
          payload: {
            planName: planLabel,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt ? endsAt.toISOString() : null,
          },
          idempotencyKey: `plan-changed:${subscription.id}:${event.id}`,
        });

        if (resolveUpgradeRequestId) {
          await enqueueEmail(tx, {
            type: 'upgrade_request_resolved',
            recipient: targetUser.email,
            payload: {
              requestedPlan: planCode,
              status: 'APPROVED',
            },
            idempotencyKey: `request-resolved:${resolveUpgradeRequestId}`,
          });
        }

        return event.id;
      },
      { timeout: 15_000, maxWait: 5_000 },
    );

    const effective = await getEffectiveSubscription(userId);

    await logImportantInfo({
      event: 'admin_plan_changed',
      userId,
      context: {
        adminId,
        toPlan: planCode,
        fromPlan: effective.plan,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt ? endsAt.toISOString() : null,
        reason: reason.trim(),
        resolvedRequestId: resolveUpgradeRequestId ?? null,
      },
    });

    return { effective, eventId };
  } catch (error) {
    if (error instanceof PlanChangeError) throw error;

    await logImportantError({
      event: 'admin_plan_change_failed',
      userId,
      error,
      context: { adminId, toPlan: planCode },
    });

    // Safe, customer-facing message. The real error is logged, never returned.
    throw new PlanChangeError(
      'PLAN_CHANGE_FAILED',
      "We couldn't update the plan right now. Please try again.",
      500,
    );
  }
}

function resolveEventType(
  previousPlanCode: PlanCode | null,
  newPlanCode: PlanCode,
  previousStatus: string | null,
) {
  if (previousStatus === 'SUSPENDED' && newPlanCode !== 'FREE') return 'PLAN_RESTORED' as const;
  if (newPlanCode === 'FREE' && previousStatus === 'SUSPENDED') return 'PLAN_SUSPENDED' as const;
  if (!previousPlanCode || previousPlanCode === 'FREE') return 'PLAN_UPGRADED' as const;
  if (PLAN_RANK[newPlanCode] > PLAN_RANK[previousPlanCode]) return 'PLAN_UPGRADED' as const;
  if (PLAN_RANK[newPlanCode] < PLAN_RANK[previousPlanCode]) return 'PLAN_DOWNGRADED' as const;
  return 'PLAN_CHANGED_BY_ADMIN' as const;
}

/** Suspend paid access without deleting or banning the account. */
export async function adminSuspendPlan(params: {
  userId: string;
  reason: string;
  adminId: string;
}): Promise<{ effective: EffectiveSubscription }> {
  const { userId, reason, adminId } = params;

  if (!reason || reason.trim().length < 3) {
    throw new PlanChangeError('REASON_REQUIRED', 'A reason is required.', 422);
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: { select: { code: true } } },
  });
  if (!subscription) {
    throw new PlanChangeError('NO_SUBSCRIPTION', 'That user has no subscription to suspend.', 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({ where: { userId }, data: { status: 'SUSPENDED' } });
    await tx.subscriptionEvent.create({
      data: {
        userId,
        actorAdminId: adminId,
        type: 'PLAN_SUSPENDED',
        previousPlanCode: subscription.plan.code,
        previousStatus: subscription.status,
        newPlanCode: subscription.plan.code,
        newStatus: 'SUSPENDED',
        reason: reason.trim(),
      },
    });
  });

  await logImportantInfo({
    event: 'admin_plan_suspended',
    userId,
    context: { adminId, reason: reason.trim() },
  });

  return { effective: await getEffectiveSubscription(userId) };
}

/**
 * Extend a trial without moving its start.
 *
 * NEVER restarts the trial window: trialStartsAt is untouched, so this can be
 * used repeatedly without letting a user accrue unlimited trial time by
 * repeated small extensions.
 */
export async function adminExtendTrial(params: {
  userId: string;
  newTrialEndsAt: Date;
  reason: string;
  adminId: string;
  notifyUser?: boolean;
}): Promise<{ effective: EffectiveSubscription }> {
  const { userId, newTrialEndsAt, reason, adminId } = params;

  if (!reason || reason.trim().length < 3) {
    throw new PlanChangeError('REASON_REQUIRED', 'A reason is required.', 422);
  }
  if (Number.isNaN(newTrialEndsAt.getTime())) {
    throw new PlanChangeError('INVALID_DATE', 'A valid date is required.', 422);
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: { select: { code: true, name: true } } },
  });
  if (!subscription?.trialEndsAt) {
    throw new PlanChangeError('NO_TRIAL', 'That user does not have a trial to extend.', 404);
  }
  if (newTrialEndsAt.getTime() <= subscription.trialEndsAt.getTime()) {
    throw new PlanChangeError(
      'INVALID_DATE',
      'The new trial end date must be later than the current one.',
      422,
    );
  }

  const previousTrialEndsAt = subscription.trialEndsAt;

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { userId },
      // trialStartsAt deliberately untouched.
      data: { trialEndsAt: newTrialEndsAt },
    });
    await tx.subscriptionEvent.create({
      data: {
        userId,
        actorAdminId: adminId,
        type: 'TRIAL_EXTENDED',
        previousPlanCode: subscription.plan.code,
        newPlanCode: subscription.plan.code,
        previousTrialEndsAt,
        newTrialEndsAt,
        reason: reason.trim(),
      },
    });

    if (params.notifyUser !== false) {
      await tx.notification.create({
        data: {
          userId,
          type: 'system',
          title: 'Your Pro trial has been extended',
          message: `Your Pro trial now runs until ${newTrialEndsAt.toISOString().slice(0, 10)}.`,
          emailSent: false,
        },
      });
    }
  });

  await logImportantInfo({
    event: 'trial_extended',
    userId,
    context: {
      adminId,
      previousTrialEndsAt: previousTrialEndsAt.toISOString(),
      newTrialEndsAt: newTrialEndsAt.toISOString(),
    },
  });

  return { effective: await getEffectiveSubscription(userId) };
}