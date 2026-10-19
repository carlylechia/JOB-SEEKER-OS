-- CreateEnum
CREATE TYPE "ApplicationMaterialType" AS ENUM ('COVER_LETTER', 'RECRUITER_OUTREACH', 'LINKEDIN_CONNECTION', 'APPLICATION_FOLLOW_UP', 'APPLICATION_STATUS_CHECK', 'INTERVIEW_THANK_YOU');

-- CreateEnum
CREATE TYPE "ApplicationMaterialStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApplicationMaterialOrigin" AS ENUM ('AI_GENERATED', 'AI_REVISED', 'TEMPLATE_DERIVED', 'MANUAL');

-- CreateTable
CREATE TABLE "ApplicationMaterial" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ApplicationMaterialType" NOT NULL,
    "status" "ApplicationMaterialStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "ApplicationMaterialOrigin" NOT NULL DEFAULT 'AI_GENERATED',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "subject" TEXT,
    "jobId" TEXT,
    "resumeId" TEXT,
    "templateId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "jobStage" TEXT,
    "appliedAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "inputFingerprint" TEXT NOT NULL,
    "generationStatus" TEXT NOT NULL DEFAULT 'PROCESSING',
    "generationMeta" JSONB,
    "errorCode" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "thinInputs" BOOLEAN NOT NULL DEFAULT false,
    "editVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationMaterial_userId_updatedAt_idx" ON "ApplicationMaterial"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ApplicationMaterial_userId_type_updatedAt_idx" ON "ApplicationMaterial"("userId", "type", "updatedAt");

-- CreateIndex
CREATE INDEX "ApplicationMaterial_userId_status_idx" ON "ApplicationMaterial"("userId", "status");

-- CreateIndex
CREATE INDEX "ApplicationMaterial_jobId_idx" ON "ApplicationMaterial"("jobId");

-- CreateIndex
CREATE INDEX "ApplicationMaterial_supersedesId_idx" ON "ApplicationMaterial"("supersedesId");

-- CreateIndex
CREATE INDEX "ApplicationMaterial_userId_inputFingerprint_idx" ON "ApplicationMaterial"("userId", "inputFingerprint");

-- AddForeignKey
ALTER TABLE "ApplicationMaterial" ADD CONSTRAINT "ApplicationMaterial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMaterial" ADD CONSTRAINT "ApplicationMaterial_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMaterial" ADD CONSTRAINT "ApplicationMaterial_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "StructuredResume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMaterial" ADD CONSTRAINT "ApplicationMaterial_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FollowUpTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMaterial" ADD CONSTRAINT "ApplicationMaterial_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ApplicationMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Safety notes for review
-- ------------------------
-- This migration is additive only. It creates one table and three enum types.
-- It does not alter or drop any existing table, column, or row, so it cannot
-- lose data and does not lock anything a running query depends on.
--
-- CREATE TYPE takes a brief ACCESS EXCLUSIVE lock only within the transaction
-- below; CREATE TABLE for a new relation takes none against existing tables.
-- The foreign keys are validated immediately (NOT DEFERRABLE), which requires
-- a SHARE ROW EXCLUSIVE lock on each referenced table for the duration of the
-- ALTER. Those tables are small and this migration runs once, in CI, before
-- the new code is served.
--
-- Every index here maps to a query this feature actually issues:
--   userId + updatedAt   the materials library, most recent first
--   userId + type        filtering the library by material type
--   userId + status      excluding archived drafts from the default view
--   jobId                 "materials for this job", from the job detail page
--   supersedesId         walking a revision chain
--   userId + inputFingerprint  reuse detection for an unchanged input set
--
-- There is deliberately NO unique constraint on inputFingerprint. A user who
-- deliberately asks for a second version of the same letter must be able to
-- have one; duplicate suppression is handled by the request idempotency key
-- and the advisory lock in usage.ts, not by forbidding a legitimate second row.
