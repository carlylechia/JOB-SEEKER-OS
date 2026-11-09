-- Administrative deletion audit trail. No foreign keys to User on purpose:
-- these rows must survive deletion of both the actor and the target.
CREATE TABLE "AdminAuditEvent" (
    "id" TEXT NOT NULL,
    "actorAdminId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "requestedCount" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "targetUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcomes" JSONB,
    "fileCleanupStatus" TEXT NOT NULL DEFAULT 'NONE',
    "fileCleanupPending" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditEvent_actorAdminId_createdAt_idx" ON "AdminAuditEvent"("actorAdminId", "createdAt");
CREATE INDEX "AdminAuditEvent_action_createdAt_idx" ON "AdminAuditEvent"("action", "createdAt");
CREATE INDEX "AdminAuditEvent_createdAt_idx" ON "AdminAuditEvent"("createdAt");

-- External file cleanup retry queue. Rows are created only from server-stored,
-- ownership-checked asset URLs captured before the user row was deleted.
CREATE TABLE "StorageCleanupTask" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageCleanupTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StorageCleanupTask_status_nextAttemptAt_idx" ON "StorageCleanupTask"("status", "nextAttemptAt");
CREATE INDEX "StorageCleanupTask_userId_idx" ON "StorageCleanupTask"("userId");
