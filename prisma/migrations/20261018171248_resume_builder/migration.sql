-- CreateTable
CREATE TABLE "StructuredResume" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "templateKey" TEXT NOT NULL DEFAULT 'classic-ats',
    "accentKey" TEXT NOT NULL DEFAULT 'gold',
    "density" INTEGER NOT NULL DEFAULT 1,
    "hiddenSections" TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "targetJobId" TEXT,
    "sourceResumeId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'BLANK',
    "sourceProfileVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StructuredResume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeOptimization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "inputFingerprint" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "data" JSONB,
    "errorCode" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "thinInputs" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ResumeOptimization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StructuredResume_userId_updatedAt_idx" ON "StructuredResume"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "StructuredResume_userId_targetJobId_idx" ON "StructuredResume"("userId", "targetJobId");

-- CreateIndex
CREATE INDEX "StructuredResume_sourceResumeId_idx" ON "StructuredResume"("sourceResumeId");

-- CreateIndex
CREATE INDEX "ResumeOptimization_userId_resumeId_createdAt_idx" ON "ResumeOptimization"("userId", "resumeId", "createdAt");

-- CreateIndex
CREATE INDEX "ResumeOptimization_userId_status_idx" ON "ResumeOptimization"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeOptimization_userId_resumeId_jobId_inputFingerprint_s_key" ON "ResumeOptimization"("userId", "resumeId", "jobId", "inputFingerprint", "schemaVersion");

-- AddForeignKey
ALTER TABLE "StructuredResume" ADD CONSTRAINT "StructuredResume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StructuredResume" ADD CONSTRAINT "StructuredResume_targetJobId_fkey" FOREIGN KEY ("targetJobId") REFERENCES "JobLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StructuredResume" ADD CONSTRAINT "StructuredResume_sourceResumeId_fkey" FOREIGN KEY ("sourceResumeId") REFERENCES "StructuredResume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeOptimization" ADD CONSTRAINT "ResumeOptimization_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "StructuredResume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeOptimization" ADD CONSTRAINT "ResumeOptimization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
