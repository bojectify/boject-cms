-- Step 1: Create ContentEntryVersion table
CREATE TABLE "ContentEntryVersion" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "entryTitle" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentEntryVersion_pkey" PRIMARY KEY ("id")
);

-- Step 2: Migrate existing ContentEntry data into versions
INSERT INTO "ContentEntryVersion" ("id", "entryId", "data", "entryTitle", "status", "publishedAt", "createdBy", "updatedBy", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "id",
    "data",
    "entryTitle",
    "status",
    "publishedAt",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt"
FROM "ContentEntry";

-- Step 3: Drop migrated columns from ContentEntry
ALTER TABLE "ContentEntry" DROP COLUMN "data";
ALTER TABLE "ContentEntry" DROP COLUMN "status";
ALTER TABLE "ContentEntry" DROP COLUMN "publishedAt";
ALTER TABLE "ContentEntry" DROP COLUMN "createdBy";
ALTER TABLE "ContentEntry" DROP COLUMN "updatedBy";

-- Step 4: Add foreign key constraint
ALTER TABLE "ContentEntryVersion" ADD CONSTRAINT "ContentEntryVersion_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "ContentEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 5: Index for fast version lookups by entry
CREATE INDEX "ContentEntryVersion_entryId_idx" ON "ContentEntryVersion"("entryId");

-- Step 6: Partial unique index — at most one active version per status per entry
CREATE UNIQUE INDEX "ContentEntryVersion_entryId_active_status"
    ON "ContentEntryVersion" ("entryId", "status")
    WHERE "status" IN ('DRAFT', 'PUBLISHED', 'CHANGED');
