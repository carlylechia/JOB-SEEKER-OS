-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "careerProfileConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "careerProfileVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "websiteUrl" TEXT;

-- CreateTable
CREATE TABLE "ResumeDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeExtraction" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "data" JSONB,
    "errorCode" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "wasTruncated" BOOLEAN NOT NULL DEFAULT false,
    "extractedChars" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ResumeExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerRecordSource" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerRecordSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerExperience" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobTitle" TEXT,
    "company" TEXT,
    "location" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "responsibilities" TEXT[],
    "achievements" TEXT[],
    "technologies" TEXT[],
    "sourceSection" TEXT,
    "evidenceSnippet" TEXT,
    "hasConflict" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerEducation" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "institution" TEXT,
    "qualification" TEXT,
    "fieldOfStudy" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "details" TEXT,
    "sourceSection" TEXT,
    "evidenceSnippet" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerSkill" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'INFERRED',
    "evidenceSnippet" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerProject" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "role" TEXT,
    "technologies" TEXT[],
    "startDate" TEXT,
    "endDate" TEXT,
    "projectUrl" TEXT,
    "results" TEXT[],
    "sourceSection" TEXT,
    "evidenceSnippet" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerCredential" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issuedDate" TEXT,
    "expiresDate" TEXT,
    "proficiency" TEXT,
    "details" TEXT,
    "sourceSection" TEXT,
    "evidenceSnippet" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeDocument_userId_createdAt_idx" ON "ResumeDocument"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResumeDocument_userId_isPrimary_idx" ON "ResumeDocument"("userId", "isPrimary");

-- CreateIndex
CREATE INDEX "ResumeExtraction_userId_createdAt_idx" ON "ResumeExtraction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResumeExtraction_userId_status_idx" ON "ResumeExtraction"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeExtraction_resumeId_contentHash_schemaVersion_key" ON "ResumeExtraction"("resumeId", "contentHash", "schemaVersion");

-- CreateIndex
CREATE INDEX "CareerRecordSource_userId_section_idx" ON "CareerRecordSource"("userId", "section");

-- CreateIndex
CREATE INDEX "CareerRecordSource_extractionId_idx" ON "CareerRecordSource"("extractionId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerRecordSource_section_recordId_key" ON "CareerRecordSource"("section", "recordId");

-- CreateIndex
CREATE INDEX "CareerExperience_userId_startDate_idx" ON "CareerExperience"("userId", "startDate");

-- CreateIndex
CREATE INDEX "CareerExperience_profileId_sortOrder_idx" ON "CareerExperience"("profileId", "sortOrder");

-- CreateIndex
CREATE INDEX "CareerExperience_company_idx" ON "CareerExperience"("company");

-- CreateIndex
CREATE INDEX "CareerEducation_userId_endDate_idx" ON "CareerEducation"("userId", "endDate");

-- CreateIndex
CREATE INDEX "CareerEducation_profileId_sortOrder_idx" ON "CareerEducation"("profileId", "sortOrder");

-- CreateIndex
CREATE INDEX "CareerSkill_userId_confirmed_idx" ON "CareerSkill"("userId", "confirmed");

-- CreateIndex
CREATE UNIQUE INDEX "CareerSkill_profileId_name_key" ON "CareerSkill"("profileId", "name");

-- CreateIndex
CREATE INDEX "CareerProject_userId_sortOrder_idx" ON "CareerProject"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "CareerProject_profileId_sortOrder_idx" ON "CareerProject"("profileId", "sortOrder");

-- CreateIndex
CREATE INDEX "CareerCredential_userId_kind_idx" ON "CareerCredential"("userId", "kind");

-- CreateIndex
CREATE INDEX "CareerCredential_profileId_sortOrder_idx" ON "CareerCredential"("profileId", "sortOrder");

-- CreateIndex
CREATE INDEX "UserProfile_careerProfileConfirmedAt_idx" ON "UserProfile"("careerProfileConfirmedAt");

-- AddForeignKey
ALTER TABLE "ResumeDocument" ADD CONSTRAINT "ResumeDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeExtraction" ADD CONSTRAINT "ResumeExtraction_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "ResumeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeExtraction" ADD CONSTRAINT "ResumeExtraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerRecordSource" ADD CONSTRAINT "CareerRecordSource_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "ResumeExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerRecordSource" ADD CONSTRAINT "CareerRecordSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerExperience" ADD CONSTRAINT "CareerExperience_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerExperience" ADD CONSTRAINT "CareerExperience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerEducation" ADD CONSTRAINT "CareerEducation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerEducation" ADD CONSTRAINT "CareerEducation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerSkill" ADD CONSTRAINT "CareerSkill_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerSkill" ADD CONSTRAINT "CareerSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerProject" ADD CONSTRAINT "CareerProject_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerProject" ADD CONSTRAINT "CareerProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerCredential" ADD CONSTRAINT "CareerCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerCredential" ADD CONSTRAINT "CareerCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill ------------------------------------------------------------------
-- Before this release a resume existed only as `UserProfile.resumeUrl`. Turn
-- every existing upload into a real ResumeDocument so existing users can analyse
-- what they already uploaded without re-uploading anything.
--
-- Safe and idempotent:
--   * INSERT only. No existing row is read, changed or removed.
--   * The NOT EXISTS guard means re-running the migration inserts nothing new.
--   * Users with no resume uploaded are untouched.
--
-- `sizeBytes` is recorded as 0 because the byte length of a legacy upload was
-- never stored; it is re-measured from the stored file on the next upload, and
-- nothing in the application branches on this value.
INSERT INTO "ResumeDocument" ("id", "userId", "url", "fileName", "format", "sizeBytes", "isPrimary", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    up."userId",
    up."resumeUrl",
    COALESCE(NULLIF(split_part(split_part(up."resumeUrl", '?', 1), '/', -1), ''), 'resume'),
    CASE
        WHEN lower(split_part(split_part(up."resumeUrl", '?', 1), '.', -1)) IN ('pdf') THEN 'pdf'
        WHEN lower(split_part(split_part(up."resumeUrl", '?', 1), '.', -1)) IN ('docx') THEN 'docx'
        WHEN lower(split_part(split_part(up."resumeUrl", '?', 1), '.', -1)) IN ('txt', 'text') THEN 'txt'
        ELSE 'unknown'
    END,
    0,
    TRUE,
    NOW(),
    NOW()
FROM "UserProfile" up
WHERE up."resumeUrl" IS NOT NULL
  AND up."resumeUrl" <> ''
  AND NOT EXISTS (
      SELECT 1 FROM "ResumeDocument" d
      WHERE d."userId" = up."userId" AND d."url" = up."resumeUrl"
  );
