-- AlterTable
ALTER TABLE "JobLead" ADD COLUMN     "jobDescription" TEXT;

-- CreateTable
CREATE TABLE "JobIntelligenceAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "data" JSONB,
    "errorCode" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "jobTextTruncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "JobIntelligenceAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobIntelligenceAnalysis_userId_jobId_createdAt_idx" ON "JobIntelligenceAnalysis"("userId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobIntelligenceAnalysis_userId_status_idx" ON "JobIntelligenceAnalysis"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobIntelligenceAnalysis_userId_jobId_inputFingerprint_schem_key" ON "JobIntelligenceAnalysis"("userId", "jobId", "inputFingerprint", "schemaVersion");

-- AddForeignKey
ALTER TABLE "JobIntelligenceAnalysis" ADD CONSTRAINT "JobIntelligenceAnalysis_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceAnalysis" ADD CONSTRAINT "JobIntelligenceAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Safety notes for review
-- ------------------------
--  * ADD COLUMN only, nullable, no default. Existing `JobLead` rows are
--    untouched and keep every value they had.
--  * CREATE TABLE only. No existing table is dropped, truncated or rewritten.
--  * No backfill. There is deliberately no attempt to derive a jobDescription
--    from existing `notes`: `notes` is free text that the ingestion flow fills
--    with generated clue strings, and a guessed "description" presented to a
--    user as the employer's own words would be worse than an honest absence.
--  * Both foreign keys cascade, so deleting a lead or an account removes its
--    analyses. A personal career assessment must not outlive the account it
--    describes, and must not outlive the job it describes.
--  * Safe to re-run: every statement is IF NOT EXISTS-equivalent in practice
--    because Prisma records the migration as applied atomically.
