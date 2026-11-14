-- CreateEnum
CREATE TYPE "ApplicationPreparationTaskType" AS ENUM ('RESUME_TAILORING', 'COVER_LETTER', 'RECRUITER_MESSAGE', 'SCREENING_ANSWERS', 'COMPANY_RESEARCH', 'INTERVIEW_BRIEFING');

-- CreateTable
CREATE TABLE "ApplicationPreparationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "requestedTasks" "ApplicationPreparationTaskType"[],
    "completedTasks" "ApplicationPreparationTaskType"[],
    "failedTasks" "ApplicationPreparationTaskType"[],
    "inputFingerprint" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "selectionJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ApplicationPreparationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationPreparationTask" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "ApplicationPreparationTaskType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "taskKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "errorCode" TEXT,
    "resultRef" TEXT,
    "resultKind" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationPreparationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationPreparationRun_dedupeKey_key" ON "ApplicationPreparationRun"("dedupeKey");

-- CreateIndex
CREATE INDEX "ApplicationPreparationRun_userId_jobId_createdAt_idx" ON "ApplicationPreparationRun"("userId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationPreparationRun_userId_status_updatedAt_idx" ON "ApplicationPreparationRun"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ApplicationPreparationTask_runId_status_createdAt_idx" ON "ApplicationPreparationTask"("runId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationPreparationTask_status_nextAttemptAt_idx" ON "ApplicationPreparationTask"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ApplicationPreparationTask_userId_jobId_type_status_idx" ON "ApplicationPreparationTask"("userId", "jobId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationPreparationTask_runId_type_key" ON "ApplicationPreparationTask"("runId", "type");

-- AddForeignKey
ALTER TABLE "ApplicationPreparationRun" ADD CONSTRAINT "ApplicationPreparationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationPreparationRun" ADD CONSTRAINT "ApplicationPreparationRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationPreparationTask" ADD CONSTRAINT "ApplicationPreparationTask_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ApplicationPreparationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
