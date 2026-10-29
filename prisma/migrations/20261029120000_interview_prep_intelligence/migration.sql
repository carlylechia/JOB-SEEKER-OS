-- Interview preparation workspace: manual packs, research provenance,
-- structured prep sections, tasks and mock-interview sessions.
--
-- Additive and non-destructive. Existing question-only packs remain readable;
-- their status is normalised to READY and the workspace offers a refresh to
-- generate the full briefing, company and plan sections.

-- ─── InterviewPrepPack ─────────────────────────────────────────────────────

ALTER TABLE "InterviewPrepPack" ALTER COLUMN "jobId" DROP NOT NULL;

ALTER TABLE "InterviewPrepPack"
  ADD COLUMN "company" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "roleTitle" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "location" TEXT,
  ADD COLUMN "jobUrl" TEXT,
  ADD COLUMN "jobDescription" TEXT,
  ADD COLUMN "researchUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "companyWebsiteUrl" TEXT,
  ADD COLUMN "careersUrl" TEXT,
  ADD COLUMN "interviewerInfo" TEXT,
  ADD COLUMN "interviewLanguage" TEXT,
  ADD COLUMN "invitationNotes" TEXT,
  ADD COLUMN "concerns" TEXT,
  ADD COLUMN "focusTopics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "interviewAt" TIMESTAMP(3),
  ADD COLUMN "interviewFormat" TEXT NOT NULL DEFAULT 'BALANCED',
  ADD COLUMN "timing" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "researchStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "researchSummary" TEXT,
  ADD COLUMN "researchErrorCode" TEXT,
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "content" JSONB,
  ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "generatedAt" TIMESTAMP(3),
  ADD COLUMN "errorCode" TEXT;

ALTER TABLE "InterviewPrepPack" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "InterviewPrepPack" ALTER COLUMN "schemaVersion" SET DEFAULT 2;
ALTER TABLE "InterviewPrepPack" ALTER COLUMN "promptVersion" SET DEFAULT 2;
ALTER TABLE "InterviewPrepPack" ALTER COLUMN "context" SET DEFAULT 'BALANCED';

UPDATE "InterviewPrepPack" p
SET
  "company" = j."company",
  "roleTitle" = j."title",
  "location" = j."location",
  "jobUrl" = j."jobUrl",
  "jobDescription" = j."jobDescription",
  "interviewFormat" = p."context",
  "status" = CASE WHEN p."status" = 'ACTIVE' THEN 'READY' ELSE p."status" END,
  "lastActivityAt" = p."updatedAt"
FROM "JobLead" j
WHERE p."jobId" = j."id";

UPDATE "InterviewPrepPack"
SET "dedupeKey" = "id"
WHERE "dedupeKey" IS NULL;

ALTER TABLE "InterviewPrepPack" ALTER COLUMN "dedupeKey" SET NOT NULL;
CREATE UNIQUE INDEX "InterviewPrepPack_dedupeKey_key" ON "InterviewPrepPack"("dedupeKey");
CREATE INDEX "InterviewPrepPack_userId_interviewAt_idx" ON "InterviewPrepPack"("userId", "interviewAt");
CREATE INDEX "InterviewPrepPack_userId_company_idx" ON "InterviewPrepPack"("userId", "company");

-- Keep the Prisma schema as the source of truth for array defaults: values are
-- always written by the service, and existing rows have been backfilled.
ALTER TABLE "InterviewPrepPack" ALTER COLUMN "focusTopics" DROP DEFAULT;

-- ─── InterviewResearchSource ───────────────────────────────────────────────

CREATE TABLE "InterviewResearchSource" (
  "id" TEXT NOT NULL,
  "packId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "kind" TEXT NOT NULL,
  "url" TEXT,
  "canonicalUrl" TEXT,
  "title" TEXT NOT NULL,
  "publisher" TEXT,
  "publishedAt" TIMESTAMP(3),
  "retrievedAt" TIMESTAMP(3),
  "excerpt" TEXT,
  "summary" TEXT,
  "fetchStatus" TEXT NOT NULL DEFAULT 'FETCHED',
  "verification" TEXT NOT NULL DEFAULT 'SOURCE_BACKED',
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InterviewResearchSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InterviewResearchSource_packId_position_idx" ON "InterviewResearchSource"("packId", "position");
CREATE INDEX "InterviewResearchSource_packId_kind_idx" ON "InterviewResearchSource"("packId", "kind");

ALTER TABLE "InterviewResearchSource"
  ADD CONSTRAINT "InterviewResearchSource_packId_fkey"
  FOREIGN KEY ("packId") REFERENCES "InterviewPrepPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── InterviewQuestion additions ───────────────────────────────────────────

ALTER TABLE "InterviewQuestion"
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "evidenceBasis" TEXT NOT NULL DEFAULT 'JOB_DESCRIPTION',
  ADD COLUMN "strongAnswerShows" TEXT,
  ADD COLUMN "commonPitfalls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "coaching" JSONB,
  ADD COLUMN "sourceRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "isPrediction" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "InterviewQuestion" ALTER COLUMN "commonPitfalls" DROP DEFAULT;
ALTER TABLE "InterviewQuestion" ALTER COLUMN "sourceRefs" DROP DEFAULT;

CREATE INDEX "InterviewQuestion_packId_priority_idx" ON "InterviewQuestion"("packId", "priority");

-- ─── InterviewPrepTask ─────────────────────────────────────────────────────

CREATE TABLE "InterviewPrepTask" (
  "id" TEXT NOT NULL,
  "packId" TEXT NOT NULL,
  "taskKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "whyItMatters" TEXT NOT NULL,
  "expectedOutput" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "category" TEXT NOT NULL DEFAULT 'PRACTICE',
  "estimatedMinutes" INTEGER NOT NULL DEFAULT 20,
  "horizon" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InterviewPrepTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InterviewPrepTask_packId_taskKey_key" ON "InterviewPrepTask"("packId", "taskKey");
CREATE INDEX "InterviewPrepTask_packId_status_priority_idx" ON "InterviewPrepTask"("packId", "status", "priority");
CREATE INDEX "InterviewPrepTask_packId_horizon_idx" ON "InterviewPrepTask"("packId", "horizon");

ALTER TABLE "InterviewPrepTask"
  ADD CONSTRAINT "InterviewPrepTask_packId_fkey"
  FOREIGN KEY ("packId") REFERENCES "InterviewPrepPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── InterviewPracticeSession ──────────────────────────────────────────────

CREATE TABLE "InterviewPracticeSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "packId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "questionIds" TEXT[] NOT NULL,
  "summary" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InterviewPracticeSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InterviewPracticeSession_userId_packId_updatedAt_idx" ON "InterviewPracticeSession"("userId", "packId", "updatedAt");
CREATE INDEX "InterviewPracticeSession_packId_status_idx" ON "InterviewPracticeSession"("packId", "status");

ALTER TABLE "InterviewPracticeSession"
  ADD CONSTRAINT "InterviewPracticeSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InterviewPracticeSession"
  ADD CONSTRAINT "InterviewPracticeSession_packId_fkey"
  FOREIGN KEY ("packId") REFERENCES "InterviewPrepPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── InterviewPracticeAttempt additions ────────────────────────────────────

ALTER TABLE "InterviewPracticeAttempt"
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'INITIAL',
  ADD COLUMN "parentAttemptId" TEXT,
  ADD COLUMN "followUpQuestion" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "InterviewPracticeAttempt" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "InterviewPracticeAttempt" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE INDEX "InterviewPracticeAttempt_sessionId_idx" ON "InterviewPracticeAttempt"("sessionId");
CREATE INDEX "InterviewPracticeAttempt_packId_kind_idx" ON "InterviewPracticeAttempt"("packId", "kind");

ALTER TABLE "InterviewPracticeAttempt"
  ADD CONSTRAINT "InterviewPracticeAttempt_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "InterviewPracticeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InterviewPracticeAttempt"
  ADD CONSTRAINT "InterviewPracticeAttempt_parentAttemptId_fkey"
  FOREIGN KEY ("parentAttemptId") REFERENCES "InterviewPracticeAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
