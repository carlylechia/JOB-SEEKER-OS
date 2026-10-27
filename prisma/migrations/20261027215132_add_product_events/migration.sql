-- Create ProductEvent table
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductEvent_name_createdAt_idx" ON "ProductEvent"("name", "createdAt");
CREATE INDEX "ProductEvent_userId_createdAt_idx" ON "ProductEvent"("userId", "createdAt");
CREATE INDEX "ProductEvent_createdAt_idx" ON "ProductEvent"("createdAt");

ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
