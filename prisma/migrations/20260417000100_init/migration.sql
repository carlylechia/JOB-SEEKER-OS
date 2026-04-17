-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "emailVerificationToken" TEXT,
    "emailVerificationExpires" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "streakCount" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" TIMESTAMP(3),
    "linkedinId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headline" TEXT,
    "portfolioUrl" TEXT,
    "githubUrl" TEXT,
    "linkedinUrl" TEXT,
    "resumeUrl" TEXT,
    "currentLevel" TEXT NOT NULL DEFAULT 'MID',
    "targetLevel" TEXT NOT NULL DEFAULT 'MID',
    "targetRoles" TEXT[],
    "preferredRegions" TEXT[],
    "preferredTitles" TEXT[],
    "preferredStack" TEXT[],
    "mustHaveTech" TEXT[],
    "workRegions" TEXT[],
    "timezoneMatches" TEXT[],
    "remoteOnly" BOOLEAN NOT NULL DEFAULT true,
    "salaryMin" INTEGER NOT NULL DEFAULT 0,
    "salaryTarget" INTEGER NOT NULL DEFAULT 0,
    "timezoneToleranceHours" INTEGER NOT NULL DEFAULT 4,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "onboardingCompletedAt" TIMESTAMP(3),
    "onboardingSkipped" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER NOT NULL DEFAULT 1,
    "profilePictureUrl" TEXT,
    "remotePreference" TEXT,
    "location" TEXT,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "profileCompletedAt" TIMESTAMP(3),
    "linkedinPhotoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT,
    "jobUrl" TEXT,
    "location" TEXT,
    "remoteType" TEXT,
    "timezoneRequirement" TEXT,
    "eligibilityRegion" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "currency" TEXT DEFAULT 'USD',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LEAD',
    "dateFound" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateApplied" TIMESTAMP(3),
    "nextFollowUp" TIMESTAMP(3),
    "priorityFlag" TEXT NOT NULL DEFAULT 'MONITOR',
    "score" JSONB NOT NULL,
    "checklist" JSONB NOT NULL,
    "contacts" JSONB NOT NULL,
    "interviews" JSONB NOT NULL,
    "prepPack" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobTitle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationToken_key" ON "User"("emailVerificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_passwordResetToken_key" ON "User"("passwordResetToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_linkedinId_key" ON "User"("linkedinId");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_emailVerificationToken_idx" ON "User"("emailVerificationToken");

-- CreateIndex
CREATE INDEX "User_passwordResetToken_idx" ON "User"("passwordResetToken");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "JobLead_userId_status_idx" ON "JobLead"("userId", "status");

-- CreateIndex
CREATE INDEX "JobLead_userId_company_idx" ON "JobLead"("userId", "company");

-- CreateIndex
CREATE INDEX "JobLead_userId_title_idx" ON "JobLead"("userId", "title");

-- CreateIndex
CREATE INDEX "JobLead_userId_priorityFlag_idx" ON "JobLead"("userId", "priorityFlag");

-- CreateIndex
CREATE INDEX "JobLead_userId_nextFollowUp_idx" ON "JobLead"("userId", "nextFollowUp");

-- CreateIndex
CREATE INDEX "JobLead_userId_updatedAt_idx" ON "JobLead"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "JobLead_createdAt_idx" ON "JobLead"("createdAt");

-- CreateIndex
CREATE INDEX "JobLead_expiresAt_idx" ON "JobLead"("expiresAt");

-- CreateIndex
CREATE INDEX "FollowUpTemplate_userId_type_idx" ON "FollowUpTemplate"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "JobTitle_name_key" ON "JobTitle"("name");

-- CreateIndex
CREATE UNIQUE INDEX "JobTitle_slug_key" ON "JobTitle"("slug");

-- CreateIndex
CREATE INDEX "JobTitle_createdAt_idx" ON "JobTitle"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLead" ADD CONSTRAINT "JobLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTemplate" ADD CONSTRAINT "FollowUpTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTitle" ADD CONSTRAINT "JobTitle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;