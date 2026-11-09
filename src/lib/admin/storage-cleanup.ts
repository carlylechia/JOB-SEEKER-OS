import { prisma } from '@/lib/prisma';
import {
  deleteStoredAssetWithResult,
  isAssetKind,
  type AssetKind,
} from '@/lib/durable-upload';

export type StorageCleanupInput = {
  kind: AssetKind;
  url: string;
  userId: string;
  reason?: string;
};

export type StorageCleanupSummary = {
  worked: number;
  completed: number;
  retried: number;
  failed: number;
};

/** Queue external files that could not be removed immediately. */
export async function enqueueStorageCleanup(tasks: StorageCleanupInput[]): Promise<number> {
  if (tasks.length === 0) return 0;
  const result = await prisma.storageCleanupTask.createMany({
    data: tasks.map((task) => ({
      kind: task.kind,
      url: task.url,
      userId: task.userId,
      reason: task.reason ?? 'admin_user_delete',
    })),
  });
  return result.count;
}

/**
 * Retry pending storage cleanup. Bounded so a cron invocation stays cheap and
 * idempotent: a successful retry removes the asset and marks the row DONE.
 */
export async function processStorageCleanupBatch(limit = 25): Promise<StorageCleanupSummary> {
  const now = new Date();
  const tasks = await prisma.storageCleanupTask.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 100),
  });

  const summary: StorageCleanupSummary = { worked: tasks.length, completed: 0, retried: 0, failed: 0 };

  for (const task of tasks) {
    if (!isAssetKind(task.kind)) {
      await prisma.storageCleanupTask.update({
        where: { id: task.id },
        data: { status: 'FAILED', attempts: task.attempts + 1, lastError: 'invalid_asset_kind' },
      });
      summary.failed += 1;
      continue;
    }

    const result = await deleteStoredAssetWithResult(task.url, {
      kind: task.kind,
      userId: task.userId,
    });

    if (result.status === 'deleted') {
      await prisma.storageCleanupTask.update({
        where: { id: task.id },
        data: { status: 'COMPLETED', attempts: task.attempts + 1, lastError: null },
      });
      summary.completed += 1;
      continue;
    }

    const attempts = task.attempts + 1;
    // A URL that fails the ownership check is not retried indefinitely: it is
    // a security condition, not a transient storage outage.
    const permanent = result.status === 'skipped' || attempts >= 8;
    await prisma.storageCleanupTask.update({
      where: { id: task.id },
      data: {
        status: permanent ? 'FAILED' : 'PENDING',
        attempts,
        lastError:
          result.status === 'failed'
            ? result.error
            : result.status === 'skipped'
              ? `asset_skipped:${result.reason}`
              : 'asset_cleanup_skipped',
        nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
      },
    });

    if (permanent) summary.failed += 1;
    else summary.retried += 1;
  }

  return summary;
}
