-- Application kits: every material for one job is read together, newest first.
--
-- Additive and non-destructive. The existing (userId, type, updatedAt) index
-- still serves the library; this composite covers the job-scoped workspace and
-- keeps the ownership predicate in the same index.

CREATE INDEX "ApplicationMaterial_userId_jobId_updatedAt_idx"
  ON "ApplicationMaterial"("userId", "jobId", "updatedAt");
