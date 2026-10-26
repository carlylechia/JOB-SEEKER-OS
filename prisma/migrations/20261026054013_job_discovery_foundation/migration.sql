-- CreateTable
CREATE TABLE "ExternalJob" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceJobId" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "applicationUrl" TEXT,
    "employerUrl" TEXT,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "remoteType" TEXT,
    "workArrangement" TEXT,
    "employmentType" TEXT,
    "description" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "currency" TEXT DEFAULT 'USD',
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "contentFingerprint" TEXT,
    "attribution" TEXT,
    "normalizedSkills" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDiscoveryRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,
    "sourcesAttempted" INTEGER NOT NULL DEFAULT 0,
    "sourcesSucceeded" INTEGER NOT NULL DEFAULT 0,
    "inputFingerprint" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyJobRecommendation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalJobId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "fitScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION,
    "scoreBreakdown" JSONB NOT NULL,
    "explanation" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RECOMMENDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyJobRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSourceHealth" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "connectorType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "failureCategory" TEXT,
    "lastError" TEXT,
    "jobsRetrieved" INTEGER NOT NULL DEFAULT 0,
    "jobsAccepted" INTEGER NOT NULL DEFAULT 0,
    "duplicatesDiscarded" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSourceHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalJob_company_title_idx" ON "ExternalJob"("company", "title");

-- CreateIndex
CREATE INDEX "ExternalJob_status_idx" ON "ExternalJob"("status");

-- CreateIndex
CREATE INDEX "ExternalJob_lastVerifiedAt_idx" ON "ExternalJob"("lastVerifiedAt");

-- CreateIndex
CREATE INDEX "ExternalJob_canonicalUrl_idx" ON "ExternalJob"("canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalJob_source_sourceJobId_key" ON "ExternalJob"("source", "sourceJobId");

-- CreateIndex
CREATE INDEX "JobDiscoveryRun_status_idx" ON "JobDiscoveryRun"("status");

-- CreateIndex
CREATE INDEX "JobDiscoveryRun_userId_localDate_idx" ON "JobDiscoveryRun"("userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "JobDiscoveryRun_userId_localDate_key" ON "JobDiscoveryRun"("userId", "localDate");

-- CreateIndex
CREATE INDEX "DailyJobRecommendation_userId_createdAt_idx" ON "DailyJobRecommendation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DailyJobRecommendation_status_idx" ON "DailyJobRecommendation"("status");

-- CreateIndex
CREATE INDEX "DailyJobRecommendation_runId_rank_idx" ON "DailyJobRecommendation"("runId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "DailyJobRecommendation_runId_externalJobId_key" ON "DailyJobRecommendation"("runId", "externalJobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSourceHealth_sourceId_key" ON "JobSourceHealth"("sourceId");

-- AddForeignKey
ALTER TABLE "JobDiscoveryRun" ADD CONSTRAINT "JobDiscoveryRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyJobRecommendation" ADD CONSTRAINT "DailyJobRecommendation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "JobDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyJobRecommendation" ADD CONSTRAINT "DailyJobRecommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyJobRecommendation" ADD CONSTRAINT "DailyJobRecommendation_externalJobId_fkey" FOREIGN KEY ("externalJobId") REFERENCES "ExternalJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
