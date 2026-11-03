-- Structured job capture and public catalog filters.
--
-- JobLead gains the canonical taxonomy fields extracted by AI capture, plus
-- the structured requirement and company profile objects. All columns are
-- additive and nullable/defaulted so existing rows keep working unchanged.
ALTER TABLE "JobLead"
  ADD COLUMN "employmentType" TEXT,
  ADD COLUMN "seniority" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requirements" JSONB,
  ADD COLUMN "companyProfile" JSONB,
  ADD COLUMN "ingestionMeta" JSONB;

CREATE INDEX "JobLead_category_idx" ON "JobLead"("category");
CREATE INDEX "JobLead_seniority_idx" ON "JobLead"("seniority");
CREATE INDEX "JobLead_employmentType_idx" ON "JobLead"("employmentType");

-- The public jobs page unions community leads with the automatically fetched
-- catalog. These indexes keep the catalog side of that query bounded.
CREATE INDEX "ExternalJob_status_category_idx" ON "ExternalJob"("status", "category");
CREATE INDEX "ExternalJob_status_seniority_idx" ON "ExternalJob"("status", "seniority");
CREATE INDEX "ExternalJob_status_employmentType_idx" ON "ExternalJob"("status", "employmentType");
CREATE INDEX "ExternalJob_status_firstSeenAt_idx" ON "ExternalJob"("status", "firstSeenAt");
