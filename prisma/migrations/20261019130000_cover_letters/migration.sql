-- CreateTable
CREATE TABLE "CoverLetter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "inputFingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "thinInputs" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverLetter_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CoverLetter" ADD CONSTRAINT "CoverLetter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverLetter" ADD CONSTRAINT "CoverLetter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "CoverLetter_userId_jobId_inputFingerprint_key" ON "CoverLetter"("userId", "jobId", "inputFingerprint");

-- CreateIndex
CREATE INDEX "CoverLetter_userId_jobId_idx" ON "CoverLetter"("userId", "jobId");

-- CreateIndex
CREATE INDEX "CoverLetter_userId_status_updatedAt_idx" ON "CoverLetter"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "CoverLetter_jobId_updatedAt_idx" ON "CoverLetter"("jobId", "updatedAt");
