import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logImportantInfo } from '@/lib/observability';
import {
  deleteStoredAssetWithResult,
  type AssetKind,
} from '@/lib/durable-upload';
import { enqueueStorageCleanup, type StorageCleanupInput } from './storage-cleanup';
import { AdminUserDeleteError } from './user-delete-error';

/**
 * Hard ceiling for a single destructive request. The UI normalises a page of
 * 25 users, but the server does not trust that: every caller is bounded.
 */
export const MAX_ADMIN_DELETE_BATCH = 50;

const USER_ID_PATTERN = /^[a-z0-9]{6,64}$/i;
const DELETE_ACTION = 'ADMIN_USER_DELETE';
const MAX_SERIALIZABLE_ATTEMPTS = 3;

export type AdminDeleteMode = 'individual' | 'bulk';
export type AdminDeleteOutcomeStatus = 'deleted' | 'skipped' | 'failed';

export type AdminDeleteOutcome = {
  userId: string;
  email?: string;
  role?: 'USER' | 'ADMIN';
  status: AdminDeleteOutcomeStatus;
  code?: string;
  message?: string;
};

export type AdminDeleteFileCleanup = {
  status: 'NONE' | 'COMPLETE' | 'PENDING';
  pending: number;
  skipped: number;
};

export type AdminDeleteResult = {
  requested: number;
  deleted: number;
  failed: number;
  skipped: number;
  outcomes: AdminDeleteOutcome[];
  auditEventId: string;
  fileCleanup: AdminDeleteFileCleanup;
};

type TargetRecord = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  profile: { resumeUrl: string | null; profilePictureUrl: string | null } | null;
  resumeDocuments: Array<{ url: string }>;
};

class ProtectedTargetError extends Error {
  readonly reason: 'SELF' | 'LAST_ADMIN';

  constructor(reason: 'SELF' | 'LAST_ADMIN') {
    super(reason);
    this.name = 'ProtectedTargetError';
    this.reason = reason;
  }
}

class TargetGoneError extends Error {
  constructor() {
    super('Target no longer exists');
    this.name = 'TargetGoneError';
  }
}

function assertValidId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AdminUserDeleteError('VALIDATION_FAILED', 'Each user id must be a string.');
  }
  const id = value.trim();
  if (!USER_ID_PATTERN.test(id)) {
    throw new AdminUserDeleteError('VALIDATION_FAILED', 'One or more user ids are malformed.');
  }
  return id;
}

/**
 * Validate, trim and de-duplicate ids. A malformed entry fails the whole
 * request rather than silently deleting the subset that happened to parse.
 */
export function normalizeAdminUserIds(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new AdminUserDeleteError('VALIDATION_FAILED', 'userIds must be an array.');
  }
  if (input.length === 0) {
    throw new AdminUserDeleteError('VALIDATION_FAILED', 'Select at least one user to delete.');
  }
  if (input.length > MAX_ADMIN_DELETE_BATCH) {
    throw new AdminUserDeleteError(
      'VALIDATION_FAILED',
      `A maximum of ${MAX_ADMIN_DELETE_BATCH} users can be deleted in one request.`,
    );
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    const id = assertValidId(value);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  if (unique.length === 0) {
    throw new AdminUserDeleteError('VALIDATION_FAILED', 'Select at least one user to delete.');
  }
  return unique;
}

export function normalizeAdminUserId(input: unknown): string {
  return assertValidId(input);
}

function isSerializationConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034'
  );
}

/**
 * Detach optional administrative references before deleting a user.
 *
 * Most user-owned tables cascade. These four relations intentionally do NOT
 * cascade because they point at an administrator acting on *another* user's
 * records; deleting the actor must not erase that history or violate the FK.
 */
async function detachAdminReferences(tx: Prisma.TransactionClient, userId: string) {
  await Promise.all([
    tx.subscription.updateMany({
      where: { updatedByAdminId: userId },
      data: { updatedByAdminId: null },
    }),
    tx.subscriptionEvent.updateMany({
      where: { actorAdminId: userId },
      data: { actorAdminId: null },
    }),
    tx.upgradeRequest.updateMany({
      where: { resolvedByAdminId: userId },
      data: { resolvedByAdminId: null },
    }),
    tx.jobTitle.updateMany({
      where: { createdById: userId },
      data: { createdById: null },
    }),
  ]);
}

async function deleteOneTarget(targetId: string, actorId: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const target = await tx.user.findUnique({
            where: { id: targetId },
            select: { id: true, role: true, email: true },
          });
          if (!target) throw new TargetGoneError();

          if (target.id === actorId) throw new ProtectedTargetError('SELF');

          if (target.role === 'ADMIN') {
            const remainingAdmins = await tx.user.count({
              where: { role: 'ADMIN', id: { not: target.id } },
            });
            if (remainingAdmins < 1) throw new ProtectedTargetError('LAST_ADMIN');
          }

          await detachAdminReferences(tx, target.id);

          // The user's own transactional email rows contain their address and
          // message payloads. They have no FK, so remove them explicitly.
          const email = target.email.trim().toLowerCase();
          if (email) {
            await tx.emailOutbox.deleteMany({ where: { recipient: { equals: email, mode: 'insensitive' } } });
          }

          await tx.user.delete({ where: { id: target.id } });
        },
        // Serializable prevents two concurrent admins from each deleting the
        // "other" last administrator and leaving zero admins behind.
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return;
    } catch (error) {
      lastError = error;
      if (isSerializationConflict(error) && attempt < MAX_SERIALIZABLE_ATTEMPTS - 1) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('User deletion did not complete.');
}

function collectAssets(target: TargetRecord): StorageCleanupInput[] {
  const assets = new Map<string, StorageCleanupInput>();
  const add = (kind: AssetKind, url: string | null | undefined) => {
    if (!url) return;
    assets.set(`${kind}:${url}`, { kind, url, userId: target.id, reason: 'admin_user_delete' });
  };

  add('resume', target.profile?.resumeUrl);
  add('avatar', target.profile?.profilePictureUrl);
  for (const document of target.resumeDocuments) add('resume', document.url);
  return Array.from(assets.values());
}

async function cleanupAssets(assets: StorageCleanupInput[]): Promise<AdminDeleteFileCleanup> {
  if (assets.length === 0) return { status: 'NONE', pending: 0, skipped: 0 };

  const retry: StorageCleanupInput[] = [];
  let skipped = 0;

  for (const asset of assets) {
    const result = await deleteStoredAssetWithResult(asset.url, {
      kind: asset.kind,
      userId: asset.userId,
    });
    if (result.status === 'failed') retry.push(asset);
    if (result.status === 'skipped') skipped += 1;
  }

  if (retry.length > 0) {
    await enqueueStorageCleanup(retry);
    return { status: 'PENDING', pending: retry.length, skipped };
  }
  return { status: 'COMPLETE', pending: 0, skipped };
}

/**
 * Delete one or more user accounts.
 *
 * This is the single server-side implementation used by both the individual
 * and bulk routes, so protected-account rules, relation handling, file cleanup
 * and audit logging can never drift between the two entry points.
 */
export async function deleteAdminUsers(params: {
  actorId: string;
  userIds: unknown;
  mode?: AdminDeleteMode;
}): Promise<AdminDeleteResult> {
  const ids = normalizeAdminUserIds(params.userIds);
  const mode: AdminDeleteMode = params.mode ?? (ids.length > 1 ? 'bulk' : 'individual');

  // Authorization is re-derived from the database. No caller-provided role or
  // permission flag is accepted as proof.
  const actor = await prisma.user.findUnique({
    where: { id: params.actorId },
    select: { id: true, email: true, role: true },
  });
  if (!actor || actor.role !== 'ADMIN') {
    throw new AdminUserDeleteError('FORBIDDEN', 'Administrator access is required.');
  }

  const targets = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      email: true,
      role: true,
      profile: { select: { resumeUrl: true, profilePictureUrl: true } },
      resumeDocuments: { select: { url: true } },
    },
  });
  const targetById = new Map(targets.map((target) => [target.id, target]));

  let auditEventId: string;
  try {
    const audit = await prisma.adminAuditEvent.create({
      data: {
        actorAdminId: actor.id,
        actorEmail: actor.email,
        action: DELETE_ACTION,
        mode,
        status: 'STARTED',
        requestedCount: ids.length,
        targetUserIds: ids,
      },
      select: { id: true },
    });
    auditEventId = audit.id;
  } catch {
    // Fail closed: an unauditable destructive operation must not start.
    throw new AdminUserDeleteError(
      'INTERNAL_ERROR',
      'Deletion was not started because the audit record could not be written.',
    );
  }

  const outcomes: AdminDeleteOutcome[] = [];
  const deletedTargets: TargetRecord[] = [];

  for (const id of ids) {
    const target = targetById.get(id);
    if (!target) {
      outcomes.push({
        userId: id,
        status: 'failed',
        code: 'NOT_FOUND',
        message: 'This account no longer exists.',
      });
      continue;
    }

    if (target.id === actor.id) {
      outcomes.push({
        userId: id,
        email: target.email,
        role: target.role,
        status: 'skipped',
        code: 'SELF',
        message: 'You cannot delete your own administrator account.',
      });
      continue;
    }

    try {
      await deleteOneTarget(target.id, actor.id);
      deletedTargets.push(target);
      outcomes.push({
        userId: id,
        email: target.email,
        role: target.role,
        status: 'deleted',
        code: 'DELETED',
      });
    } catch (error) {
      if (error instanceof ProtectedTargetError) {
        outcomes.push({
          userId: id,
          email: target.email,
          role: target.role,
          status: 'skipped',
          code: error.reason,
          message:
            error.reason === 'SELF'
              ? 'You cannot delete your own administrator account.'
              : 'The last active administrator account cannot be deleted.',
        });
      } else if (error instanceof TargetGoneError) {
        outcomes.push({
          userId: id,
          email: target.email,
          role: target.role,
          status: 'failed',
          code: 'NOT_FOUND',
          message: 'This account no longer exists.',
        });
      } else {
        await logImportantInfo({
          event: 'admin_user_delete_target_failed',
          userId: actor.id,
          context: {
            targetUserId: id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
        });
        outcomes.push({
          userId: id,
          email: target.email,
          role: target.role,
          status: 'failed',
          code: 'DELETE_FAILED',
          message: 'This account could not be deleted. No changes were made to it.',
        });
      }
    }
  }

  const assets = deletedTargets.flatMap(collectAssets);
  let fileCleanup: AdminDeleteFileCleanup;
  try {
    fileCleanup = await cleanupAssets(assets);
  } catch (error) {
    await logImportantInfo({
      event: 'admin_user_delete_file_cleanup_failed',
      userId: actor.id,
      context: {
        auditEventId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        assetCount: assets.length,
      },
    });
    // The database deletion is already committed. Keep the state explicit and
    // retryable rather than pretending the files are gone.
    fileCleanup = { status: 'PENDING', pending: assets.length, skipped: 0 };
  }

  const deleted = outcomes.filter((outcome) => outcome.status === 'deleted').length;
  const failed = outcomes.filter((outcome) => outcome.status === 'failed').length;
  const skipped = outcomes.filter((outcome) => outcome.status === 'skipped').length;
  const status = failed === 0 && skipped === 0 ? 'COMPLETED' : deleted > 0 ? 'PARTIAL' : 'FAILED';

  try {
    await prisma.adminAuditEvent.update({
      where: { id: auditEventId },
      data: {
        status,
        deletedCount: deleted,
        failedCount: failed,
        skippedCount: skipped,
        outcomes: outcomes as unknown as Prisma.InputJsonValue,
        fileCleanupStatus: fileCleanup.status,
        fileCleanupPending: fileCleanup.pending,
      },
    });
  } catch (error) {
    await logImportantInfo({
      event: 'admin_user_delete_audit_finalize_failed',
      userId: actor.id,
      context: {
        auditEventId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        deleted,
        failed,
        skipped,
      },
    });
    throw new AdminUserDeleteError(
      'AUDIT_FAILED',
      'Account processing finished, but the audit record could not be finalized. Review the audit log before retrying.',
    );
  }

  // A final operational line complements the durable audit row. It is logged
  // even for partial outcomes; no resumes, tokens or answers are included.
  await logImportantInfo({
    event: 'admin_user_delete_completed',
    userId: actor.id,
    context: {
      auditEventId,
      mode,
      requested: ids.length,
      deleted,
      failed,
      skipped,
      fileCleanupStatus: fileCleanup.status,
      fileCleanupPending: fileCleanup.pending,
    },
  });

  return {
    requested: ids.length,
    deleted,
    failed,
    skipped,
    outcomes,
    auditEventId,
    fileCleanup,
  };
}
