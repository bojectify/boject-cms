-- Add identifier column (nullable first for backfill)
ALTER TABLE "ContentType" ADD COLUMN "identifier" TEXT;

-- Backfill: convert name to PascalCase identifier (remove spaces, capitalize each word)
UPDATE "ContentType"
SET "identifier" = REPLACE(INITCAP("name"), ' ', '');

-- Make non-null and unique
ALTER TABLE "ContentType" ALTER COLUMN "identifier" SET NOT NULL;
CREATE UNIQUE INDEX "ContentType_identifier_key" ON "ContentType"("identifier");
