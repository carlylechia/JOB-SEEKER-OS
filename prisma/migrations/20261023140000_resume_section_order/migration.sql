ALTER TABLE "StructuredResume"
ADD COLUMN "sectionOrder" TEXT[] NOT NULL DEFAULT ARRAY['summary', 'experience', 'skills', 'education', 'projects', 'credentials']::TEXT[];
