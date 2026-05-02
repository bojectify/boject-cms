-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill all existing keys to retain GraphQL access. Newly-created
-- keys go through the explicit --scopes flag, so the default-empty
-- column is the safer default for new rows.
UPDATE "ApiKey" SET "scopes" = ARRAY['content:read'] WHERE COALESCE(array_length("scopes", 1), 0) = 0;
