-- AlterTable
ALTER TABLE "DailyJobRecommendation" ADD COLUMN     "dataConfidence" DOUBLE PRECISION,
ADD COLUMN     "eligibility" JSONB,
ADD COLUMN     "listingQuality" DOUBLE PRECISION,
ADD COLUMN     "rankingScore" DOUBLE PRECISION,
ADD COLUMN     "sourceConfidence" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ExternalJob" ADD COLUMN     "allowStructuredData" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "attributionRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "attributionUrl" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "countryCodes" TEXT[],
ADD COLUMN     "dataConfidence" DOUBLE PRECISION,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "listingQuality" DOUBLE PRECISION,
ADD COLUMN     "locationRestrictions" TEXT[],
ADD COLUMN     "retentionDays" INTEGER,
ADD COLUMN     "salaryPeriod" TEXT,
ADD COLUMN     "seniority" TEXT,
ADD COLUMN     "skills" TEXT[],
ADD COLUMN     "sourceConfidence" DOUBLE PRECISION,
ADD COLUMN     "timezoneRestrictions" INTEGER[],
ADD COLUMN     "visaSponsorship" TEXT;

-- AlterTable
ALTER TABLE "JobDiscoveryRun" ADD COLUMN     "catalogSyncRunId" TEXT;

-- AlterTable
ALTER TABLE "JobSourceHealth" ADD COLUMN     "avgLatencyMs" INTEGER,
ADD COLUMN     "boardsAttempted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "boardsSucceeded" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "catalogJobsAccepted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "catalogJobsRetrieved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCatalogRunId" TEXT,
ADD COLUMN     "lastCatalogSyncAt" TIMESTAMP(3),
ADD COLUMN     "quotaState" TEXT,
ADD COLUMN     "rateLimitRemaining" INTEGER;

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "employmentTypes" TEXT[],
ADD COLUMN     "preferredIndustries" TEXT[],
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN     "visaSponsorshipRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "workCountries" TEXT[];

-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "employerName" TEXT,
    "boardToken" TEXT,
    "careersUrl" TEXT,
    "country" TEXT,
    "region" TEXT,
    "industry" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "descriptionMode" TEXT NOT NULL DEFAULT 'full',
    "attribution" TEXT,
    "attributionUrl" TEXT,
    "attributionRequired" BOOLEAN NOT NULL DEFAULT false,
    "allowStructuredData" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "failureCategory" TEXT,
    "jobsRetrieved" INTEGER NOT NULL DEFAULT 0,
    "jobsAccepted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCatalogSyncRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'cron',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "providersAttempted" INTEGER NOT NULL DEFAULT 0,
    "providersSucceeded" INTEGER NOT NULL DEFAULT 0,
    "providersFailed" INTEGER NOT NULL DEFAULT 0,
    "boardsAttempted" INTEGER NOT NULL DEFAULT 0,
    "boardsSucceeded" INTEGER NOT NULL DEFAULT 0,
    "jobsRetrieved" INTEGER NOT NULL DEFAULT 0,
    "jobsCreated" INTEGER NOT NULL DEFAULT 0,
    "jobsUpdated" INTEGER NOT NULL DEFAULT 0,
    "jobsClosed" INTEGER NOT NULL DEFAULT 0,
    "duplicatesDiscarded" INTEGER NOT NULL DEFAULT 0,
    "timeBudgetExhausted" BOOLEAN NOT NULL DEFAULT false,
    "quotaStopped" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCatalogSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobSource_provider_enabled_idx" ON "JobSource"("provider", "enabled");

-- CreateIndex
CREATE INDEX "JobSource_lastSyncedAt_idx" ON "JobSource"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_provider_boardToken_key" ON "JobSource"("provider", "boardToken");

-- CreateIndex
CREATE INDEX "JobCatalogSyncRun_startedAt_idx" ON "JobCatalogSyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "JobCatalogSyncRun_status_idx" ON "JobCatalogSyncRun"("status");

-- CreateIndex
CREATE INDEX "ExternalJob_status_lastSeenAt_idx" ON "ExternalJob"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ExternalJob_expiresAt_idx" ON "ExternalJob"("expiresAt");

-- CreateIndex
CREATE INDEX "ExternalJob_source_idx" ON "ExternalJob"("source");

-- CreateIndex
CREATE INDEX "JobDiscoveryRun_catalogSyncRunId_idx" ON "JobDiscoveryRun"("catalogSyncRunId");
