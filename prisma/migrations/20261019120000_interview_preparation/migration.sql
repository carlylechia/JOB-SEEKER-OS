-- CreateTable
CREATE TABLE "InterviewPrepPack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "inputFingerprint" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "practicedCount" INTEGER NOT NULL DEFAULT 0,
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "lastPracticedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewPrepPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "competency" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "whyMatters" TEXT,
    "relatedRequirement" TEXT,
    "relevantExperience" TEXT,
    "prepNotes" TEXT,
    "answerStructure" TEXT,
    "followUpQuestionIds" TEXT[] NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceEvidence" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewPracticeAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionVersion" INTEGER NOT NULL,
    "answer" TEXT NOT NULL,
    "feedback" JSONB,
    "rubricKey" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewPracticeAttempt_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InterviewPrepPack" ADD CONSTRAINT "InterviewPrepPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPrepPack" ADD CONSTRAINT "InterviewPrepPack_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_packId_fkey" FOREIGN KEY ("packId") REFERENCES "InterviewPrepPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPracticeAttempt" ADD CONSTRAINT "InterviewPracticeAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPracticeAttempt" ADD CONSTRAINT "InterviewPracticeAttempt_packId_fkey" FOREIGN KEY ("packId") REFERENCES "InterviewPrepPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPracticeAttempt" ADD CONSTRAINT "InterviewPracticeAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "InterviewQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "InterviewPrepPack_userId_jobId_idx" ON "InterviewPrepPack"("userId", "jobId");

-- CreateIndex
CREATE INDEX "InterviewPrepPack_userId_status_updatedAt_idx" ON "InterviewPrepPack"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "InterviewPrepPack_jobId_updatedAt_idx" ON "InterviewPrepPack"("jobId", "updatedAt");

-- CreateIndex
CREATE INDEX "InterviewQuestion_packId_ordinal_idx" ON "InterviewQuestion"("packId", "ordinal");

-- CreateIndex
CREATE INDEX "InterviewQuestion_packId_isActive_idx" ON "InterviewQuestion"("packId", "isActive");

-- CreateIndex
CREATE INDEX "InterviewQuestion_packId_version_idx" ON "InterviewQuestion"("packId", "version");

-- CreateIndex
CREATE INDEX "InterviewPracticeAttempt_userId_packId_idx" ON "InterviewPracticeAttempt"("userId", "packId");

-- CreateIndex
CREATE INDEX "InterviewPracticeAttempt_packId_questionId_idx" ON "InterviewPracticeAttempt"("packId", "questionId");

-- CreateIndex
CREATE INDEX "InterviewPracticeAttempt_userId_createdAt_idx" ON "InterviewPracticeAttempt"("userId", "createdAt");
