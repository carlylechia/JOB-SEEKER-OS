/**
 * User-facing upgrade request creation.
 *
 * SECURITY RULES (enforced server-side):
 *   - `userId` ALWAYS comes from the authenticated session, never the body
 *   - the user can never set `status`, `userId`, or a plan directly
 *   - duplicate pending requests are refused, not silently duplicated
 */

import { prisma } from '@/lib/prisma';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { getEffectiveSubscription } from './subscriptions';
import { enqueueEmail, enqueueEmailBestEffort } from './email-outbox';
import {
  sanitizeUpgradeRequest,
  type UpgradeRequestInput,
  type UpgradeRequestStatus,
} from './upgrade-requests';

export class DuplicateRequestError extends Error {
  readonly code = 'DUPLICATE_REQUEST';
  readonly status = 409;
  readonly existingRequestId: string;
  readonly existingStatus: UpgradeRequestStatus;

  constructor(id: string, status: UpgradeRequestStatus) {
    super('You already have an upgrade request in progress.');
    this.name = 'DuplicateRequestError';
    this.existingRequestId = id;
    this.existingStatus = status;
  }
}

/** Statuses that count as "still open" and block a new request. */
const OPEN_STATUSES: UpgradeRequestStatus[] = ['PENDING', 'CONTACTED'];

export async function createUpgradeRequest(params: {
  userId: string;
  input: UpgradeRequestInput;
}): Promise<{ id: string; status: UpgradeRequestStatus }> {
  const { userId } = params;
  const data = sanitizeUpgradeRequest(params.input);

  // Duplicate protection: refuse while an open request exists, so the user
  // sees a clear conflict instead of a pile of identical rows.
  const open = await prisma.upgradeRequest.findFirst({
    where: { userId, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });

  if (open) throw new DuplicateRequestError(open.id, open.status);

  // Snapshot what the user currently has, so the record stays meaningful even
  // after their subscription changes.
  const effective = await getEffectiveSubscription(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw new Error('User not found');

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.upgradeRequest.create({
      data: {
        userId,
        requestedPlan: data.requestedPlan,
        currentPlanSnapshot: effective.plan,
        currentStatusSnapshot: effective.status === 'NONE' ? 'ACTIVE' : effective.status,
        contactMethod: data.contactMethod,
        contactEmail: data.contactEmail ?? user.email,
        whatsappNumber: data.whatsappNumber,
        message: data.message,
        status: 'PENDING',
      },
      select: { id: true, status: true },
    });

    await tx.notification.create({
      data: {
        userId,
        type: 'system',
        title: 'Upgrade request received',
        message: `We received your request for the ${data.requestedPlan.charAt(0)}${data.requestedPlan.slice(1).toLowerCase()} plan. Our team will contact you to finalise the details.`,
        emailSent: false,
      },
    });

    // Acknowledgement to the user — queued in the same transaction.
    await enqueueEmail(tx, {
      type: 'upgrade_request_received',
      recipient: user.email,
      payload: { requestedPlan: data.requestedPlan, contactMethod: data.contactMethod },
      idempotencyKey: `upgrade-request-ack:${request.id}`,
    });

    return request;
  });

  // Best-effort admin notification, AFTER commit. The request already exists,
  // so a failure here can never lose it.
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (adminEmail) {
    await enqueueEmailBestEffort({
      type: 'admin_upgrade_request_notification',
      recipient: adminEmail,
      payload: {
        userName: user.name ?? user.email,
        userEmail: user.email,
        requestedPlan: data.requestedPlan,
        contactMethod: data.contactMethod,
        contactEmail: data.contactEmail ?? user.email,
        whatsappNumber: data.whatsappNumber ?? null,
        message: data.message,
      },
      idempotencyKey: `admin-upgrade-notification:${created.id}`,
    });
  }

  await logImportantInfo({
    event: 'upgrade_request_created',
    userId,
    context: {
      requestId: created.id,
      requestedPlan: data.requestedPlan,
      contactMethod: data.contactMethod,
    },
  });

  return created;
}

/** A user may withdraw their own request while it is still open. */
export async function cancelOwnUpgradeRequest(params: {
  userId: string;
  requestId: string;
}): Promise<void> {
  const { userId, requestId } = params;

  const request = await prisma.upgradeRequest.findUnique({
    where: { id: requestId },
    select: { id: true, userId: true, status: true },
  });

  // Never reveal whether someone else's request exists.
  if (!request || request.userId !== userId) {
    throw new Error('Upgrade request not found');
  }

  if (request.status !== 'PENDING' && request.status !== 'CONTACTED') {
    throw new Error('This request can no longer be cancelled');
  }

  await prisma.upgradeRequest.update({
    where: { id: requestId },
    data: { status: 'CANCELLED', resolvedAt: new Date() },
  });

  await logImportantInfo({
    event: 'upgrade_request_cancelled',
    userId,
    context: { requestId },
  });
}

/** The user's current/most recent upgrade request, for the billing page. */
export async function getUserUpgradeRequest(userId: string) {
  return prisma.upgradeRequest.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      requestedPlan: true,
      status: true,
      contactMethod: true,
      message: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
}

/** Admin-side status update that enforces the state machine. */
export async function adminUpdateUpgradeRequestStatus(params: {
  requestId: string;
  to: UpgradeRequestStatus;
  adminId: string;
  adminNote?: string | null;
}) {
  const { requestId, to, adminId } = params;

  const { assertTransition } = await import('./upgrade-requests');

  const request = await prisma.upgradeRequest.findUnique({
    where: { id: requestId },
    select: { id: true, userId: true, status: true, requestedPlan: true },
  });

  if (!request) {
    const err = new Error('Upgrade request not found') as Error & { code: string; status: number };
    err.code = 'REQUEST_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  try {
    assertTransition(request.status as UpgradeRequestStatus, to);
  } catch (error) {
    await logImportantInfo({
      event: 'upgrade_request_conflict',
      userId: request.userId,
      context: { requestId, from: request.status, to },
    });
    throw error;
  }

  const resolving = to === 'APPROVED' || to === 'REJECTED';

  await prisma.$transaction(async (tx) => {
    await tx.upgradeRequest.update({
      where: { id: requestId },
      data: {
        status: to,
        adminNote: params.adminNote ?? undefined,
        resolvedByAdminId: resolving ? adminId : undefined,
        resolvedAt: resolving ? new Date() : undefined,
      },
    });
  });

  await logImportantInfo({
    event: `upgrade_request_${to.toLowerCase()}`,
    userId: request.userId,
    context: { requestId, adminId },
  });

  return request;
}