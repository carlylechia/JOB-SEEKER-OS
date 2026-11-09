/**
 * Admin user deletion integration tests.
 *
 * These run against the real Postgres database configured by
 * TEST_DATABASE_URL / DATABASE_URL because the deletion service depends on
 * foreign-key cascade behaviour, serializable transactions and the durable
 * audit/cleanup tables. Nothing here mocks Prisma.
 */

import { describe, it, expect, afterEach } from './harness';
import { prisma } from '@/lib/prisma';
import {
  deleteAdminUsers,
  normalizeAdminUserIds,
  MAX_ADMIN_DELETE_BATCH,
} from '@/lib/admin/user-deletion';
import { AdminUserDeleteError } from '@/lib/admin/user-delete-error';
import { processStorageCleanupBatch } from '@/lib/admin/storage-cleanup';
import { createUser, destroyUser } from './helpers';

const createdUserIds: string[] = [];
const createdJobTitleIds: string[] = [];
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

async function trackUser<T extends { id: string }>(p: Promise<T>): Promise<T> {
  const user = await p;
  createdUserIds.push(user.id);
  return user;
}

afterEach(async () => {
  const ids = createdUserIds.splice(0);
  for (const id of ids) {
    await prisma.storageCleanupTask.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.adminAuditEvent
      .deleteMany({
        where: {
          OR: [{ actorAdminId: id }, { targetUserIds: { has: id } }],
        },
      })
      .catch(() => undefined);
  }
  for (const id of createdJobTitleIds.splice(0)) {
    await prisma.jobTitle.deleteMany({ where: { id } }).catch(() => undefined);
  }
  for (const id of ids) {
    await destroyUser(id).catch(() => undefined);
  }
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
});

describe('admin user deletion — validation', () => {
  it('trims and de-duplicates ids while preserving order', () => {
    expect(normalizeAdminUserIds(['abc123', ' abc123 ', 'def456'])).toEqual(['abc123', 'def456']);
  });

  it('rejects an empty selection', () => {
    try {
      normalizeAdminUserIds([]);
    } catch (error) {
      expect(error).toBeInstanceOf(AdminUserDeleteError);
      expect((error as AdminUserDeleteError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects malformed ids instead of deleting a parsed subset', () => {
    try {
      normalizeAdminUserIds(['abc123', '../../etc/passwd']);
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminUserDeleteError);
      expect((error as AdminUserDeleteError).code).toBe('VALIDATION_FAILED');
    }
  });

  it(`rejects more than ${MAX_ADMIN_DELETE_BATCH} ids`, () => {
    const ids = Array.from({ length: MAX_ADMIN_DELETE_BATCH + 1 }, (_, index) =>
      `user${String(index).padStart(6, '0')}`,
    );
    try {
      normalizeAdminUserIds(ids);
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminUserDeleteError);
      expect((error as AdminUserDeleteError).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('admin user deletion — individual', () => {
  it('deletes the account, cascades owned data, removes outbox mail and writes an audit row', async () => {
    const admin = await trackUser(createUser({ role: 'ADMIN' }));
    const target = await trackUser(createUser({ email: 'target-individual@example.test' }));

    await prisma.userProfile.create({
      data: {
        userId: target.id,
        resumeUrl: `/uploads/resumes/${target.id}-primary.pdf`,
        profilePictureUrl: `/uploads/avatars/${target.id}-avatar.png`,
      },
    });
    await prisma.resumeDocument.create({
      data: {
        userId: target.id,
        url: `/uploads/resumes/${target.id}-primary.pdf`,
        fileName: 'cv.pdf',
        format: 'pdf',
        sizeBytes: 1234,
      },
    });
    await prisma.emailOutbox.create({
      data: {
        type: 'welcome',
        // Deliberately different case: deletion must be case-insensitive.
        recipient: target.email.toUpperCase(),
        payload: {},
      },
    });

    const result = await deleteAdminUsers({
      actorId: admin.id,
      userIds: [target.id],
      mode: 'individual',
    });

    expect(result.requested).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.outcomes[0]?.code).toBe('DELETED');
    expect(result.auditEventId).toBeTruthy();

    expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await prisma.userProfile.findUnique({ where: { userId: target.id } })).toBeNull();
    expect(await prisma.resumeDocument.count({ where: { userId: target.id } })).toBe(0);
    expect(
      await prisma.emailOutbox.count({
        where: { recipient: { equals: target.email, mode: 'insensitive' } },
      }),
    ).toBe(0);

    const audit = await prisma.adminAuditEvent.findUniqueOrThrow({
      where: { id: result.auditEventId },
    });
    expect(audit.action).toBe('ADMIN_USER_DELETE');
    expect(audit.mode).toBe('individual');
    expect(audit.status).toBe('COMPLETED');
    expect(audit.deletedCount).toBe(1);
    expect(audit.targetUserIds).toEqual([target.id]);
  });

  it('keeps the audit row after both the actor and target accounts are gone', async () => {
    const actor = await trackUser(createUser({ role: 'ADMIN' }));
    const target = await trackUser(createUser());

    const result = await deleteAdminUsers({ actorId: actor.id, userIds: [target.id] });
    expect(result.deleted).toBe(1);

    // Simulate an actor later leaving the platform through any path. The audit
    // table has no User foreign key, so the record must survive.
    await prisma.user.delete({ where: { id: actor.id } });

    const audit = await prisma.adminAuditEvent.findUnique({
      where: { id: result.auditEventId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorAdminId).toBe(actor.id);
    expect(audit?.targetUserIds).toEqual([target.id]);
  });

  it('skips self-deletion and leaves the administrator intact', async () => {
    const admin = await trackUser(createUser({ role: 'ADMIN' }));

    const result = await deleteAdminUsers({
      actorId: admin.id,
      userIds: [admin.id],
      mode: 'individual',
    });

    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.outcomes[0]?.code).toBe('SELF');
    expect(await prisma.user.findUnique({ where: { id: admin.id } })).not.toBeNull();

    const audit = await prisma.adminAuditEvent.findUniqueOrThrow({
      where: { id: result.auditEventId },
    });
    expect(audit.status).toBe('FAILED');
    expect(audit.skippedCount).toBe(1);
  });

  it('refuses a non-admin actor before touching the target', async () => {
    const actor = await trackUser(createUser());
    const target = await trackUser(createUser());

    try {
      await deleteAdminUsers({ actorId: actor.id, userIds: [target.id] });
      throw new Error('expected authorization to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminUserDeleteError);
      expect((error as AdminUserDeleteError).code).toBe('FORBIDDEN');
    }

    expect(await prisma.user.findUnique({ where: { id: target.id } })).not.toBeNull();
    expect(
      await prisma.adminAuditEvent.count({
        where: { actorAdminId: actor.id, action: 'ADMIN_USER_DELETE' },
      }),
    ).toBe(0);
  });
});

describe('admin user deletion — bulk', () => {
  it('reports partial success with per-target outcomes and a PARTIAL audit row', async () => {
    const admin = await trackUser(createUser({ role: 'ADMIN' }));
    const first = await trackUser(createUser({ email: 'bulk-first@example.test' }));
    const second = await trackUser(createUser({ email: 'bulk-second@example.test' }));

    const result = await deleteAdminUsers({
      actorId: admin.id,
      userIds: [first.id, 'missing123', admin.id, second.id],
      mode: 'bulk',
    });

    expect(result.requested).toBe(4);
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);

    const byId = new Map(result.outcomes.map((outcome) => [outcome.userId, outcome]));
    expect(byId.get(first.id)?.status).toBe('deleted');
    expect(byId.get(second.id)?.status).toBe('deleted');
    expect(byId.get('missing123')?.code).toBe('NOT_FOUND');
    expect(byId.get(admin.id)?.code).toBe('SELF');

    expect(await prisma.user.findUnique({ where: { id: first.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: second.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: admin.id } })).not.toBeNull();

    const audit = await prisma.adminAuditEvent.findUniqueOrThrow({
      where: { id: result.auditEventId },
    });
    expect(audit.status).toBe('PARTIAL');
    expect(audit.mode).toBe('bulk');
    expect(audit.requestedCount).toBe(4);
    expect(audit.deletedCount).toBe(2);
    expect(audit.failedCount).toBe(1);
    expect(audit.skippedCount).toBe(1);
  });
});

describe('admin user deletion — relations and storage', () => {
  it('detaches optional admin references instead of failing the delete', async () => {
    const actor = await trackUser(createUser({ role: 'ADMIN' }));
    const targetAdmin = await trackUser(createUser({ role: 'ADMIN' }));
    const owner = await trackUser(createUser());

    const plan = await prisma.plan.findFirstOrThrow({ where: { code: 'FREE' } });
    const subscription = await prisma.subscription.create({
      data: {
        userId: owner.id,
        planId: plan.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedByAdminId: targetAdmin.id,
      },
    });
    const request = await prisma.upgradeRequest.create({
      data: {
        userId: owner.id,
        requestedPlan: 'PRO',
        contactMethod: 'EMAIL',
        message: 'Please upgrade me',
        resolvedByAdminId: targetAdmin.id,
        status: 'APPROVED',
      },
    });
    const event = await prisma.subscriptionEvent.create({
      data: {
        userId: owner.id,
        actorAdminId: targetAdmin.id,
        type: 'PLAN_UPGRADED',
        newPlanCode: 'PRO',
      },
    });
    const suffix = Math.random().toString(36).slice(2, 8);
    const jobTitle = await prisma.jobTitle.create({
      data: {
        name: `Detach Test ${suffix}`,
        slug: `detach-test-${suffix}`,
        createdById: targetAdmin.id,
      },
    });
    createdJobTitleIds.push(jobTitle.id);

    const result = await deleteAdminUsers({
      actorId: actor.id,
      userIds: [targetAdmin.id],
    });

    expect(result.deleted).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: targetAdmin.id } })).toBeNull();

    const survivingSubscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(survivingSubscription.updatedByAdminId).toBeNull();

    const survivingRequest = await prisma.upgradeRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(survivingRequest.resolvedByAdminId).toBeNull();

    const survivingEvent = await prisma.subscriptionEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(survivingEvent.actorAdminId).toBeNull();

    const survivingJobTitle = await prisma.jobTitle.findUniqueOrThrow({
      where: { id: jobTitle.id },
    });
    expect(survivingJobTitle.createdById).toBeNull();
  });

  it('queues failed external cleanup and reports it as pending', async () => {
    // No blob token: the owned blob URL cannot be removed, which must become an
    // explicit retryable state rather than a false "fully deleted" message.
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const admin = await trackUser(createUser({ role: 'ADMIN' }));
    const target = await trackUser(createUser());
    const blobUrl = `https://store.private.blob.vercel-storage.com/resumes/${target.id}/cv.pdf`;
    await prisma.userProfile.create({
      data: { userId: target.id, resumeUrl: blobUrl, profilePictureUrl: blobUrl.replace('/resumes/', '/avatars/') },
    });

    const result = await deleteAdminUsers({ actorId: admin.id, userIds: [target.id] });

    expect(result.deleted).toBe(1);
    expect(result.fileCleanup.status).toBe('PENDING');
    expect(result.fileCleanup.pending).toBe(2);

    const tasks = await prisma.storageCleanupTask.findMany({
      where: { userId: target.id },
      orderBy: { kind: 'asc' },
    });
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.status === 'PENDING')).toBe(true);

    const audit = await prisma.adminAuditEvent.findUniqueOrThrow({
      where: { id: result.auditEventId },
    });
    expect(audit.fileCleanupStatus).toBe('PENDING');
    expect(audit.fileCleanupPending).toBe(2);
  });

  it('skips URLs outside the user namespace and never queues or deletes them', async () => {
    const admin = await trackUser(createUser({ role: 'ADMIN' }));
    const target = await trackUser(createUser());
    await prisma.userProfile.create({
      data: {
        userId: target.id,
        resumeUrl: '/uploads/resumes/somebody-else-cv.pdf',
        profilePictureUrl: '/uploads/avatars/somebody-else-avatar.png',
      },
    });

    const result = await deleteAdminUsers({ actorId: admin.id, userIds: [target.id] });

    expect(result.deleted).toBe(1);
    expect(result.fileCleanup.status).toBe('COMPLETE');
    expect(result.fileCleanup.skipped).toBe(2);
    expect(await prisma.storageCleanupTask.count({ where: { userId: target.id } })).toBe(0);
  });

  it('retries the cleanup queue and completes an owned local asset', async () => {
    const user = await trackUser(createUser());
    const task = await prisma.storageCleanupTask.create({
      data: {
        kind: 'resume',
        url: `/uploads/resumes/${user.id}-already-gone.pdf`,
        userId: user.id,
        reason: 'admin_user_delete',
      },
    });

    const summary = await processStorageCleanupBatch(10);
    expect(summary.completed).toBeGreaterThanOrEqual(1);

    const updated = await prisma.storageCleanupTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.status).toBe('COMPLETED');
    expect(updated.attempts).toBe(1);
    expect(updated.lastError).toBeNull();
  });

  it('permanently fails a task whose URL is outside the user namespace', async () => {
    const user = await trackUser(createUser());
    const task = await prisma.storageCleanupTask.create({
      data: {
        kind: 'resume',
        url: `/uploads/avatars/${user.id}-not-a-resume.png`,
        userId: user.id,
      },
    });

    await processStorageCleanupBatch(10);

    const updated = await prisma.storageCleanupTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.status).toBe('FAILED');
    expect(updated.lastError).toContain('not_owned');
  });
});
