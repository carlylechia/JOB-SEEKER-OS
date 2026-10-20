-- DropIndex
DROP INDEX "ApplicationMaterial_userId_inputFingerprint_idx";

-- CreateTable
CREATE TABLE "CareerAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "relatedJobId" TEXT,
    "relatedResumeId" TEXT,
    "relatedPrepPackId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'SYSTEM',
    "snoozedUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareerAction_userId_status_idx" ON "CareerAction"("userId", "status");

-- CreateIndex
CREATE INDEX "CareerAction_userId_priority_idx" ON "CareerAction"("userId", "priority");

-- CreateIndex
CREATE INDEX "CareerAction_userId_dueDate_idx" ON "CareerAction"("userId", "dueDate");

-- CreateIndex
CREATE INDEX "CareerAction_userId_createdAt_idx" ON "CareerAction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CareerAction_relatedJobId_idx" ON "CareerAction"("relatedJobId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerAction_userId_actionType_sourceId_key" ON "CareerAction"("userId", "actionType", "sourceId");

-- AddForeignKey
ALTER TABLE "CareerAction" ADD CONSTRAINT "CareerAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerAction" ADD CONSTRAINT "CareerAction_relatedJobId_fkey" FOREIGN KEY ("relatedJobId") REFERENCES "JobLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerAction" ADD CONSTRAINT "CareerAction_relatedResumeId_fkey" FOREIGN KEY ("relatedResumeId") REFERENCES "StructuredResume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerAction" ADD CONSTRAINT "CareerAction_relatedPrepPackId_fkey" FOREIGN KEY ("relatedPrepPackId") REFERENCES "InterviewPrepPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ApplicationMaterial_userId_type_inputFingerprint_schemaVersion_" RENAME TO "ApplicationMaterial_userId_type_inputFingerprint_schemaVers_key";
