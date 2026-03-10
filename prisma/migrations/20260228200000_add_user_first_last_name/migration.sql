-- AlterTable: split name into firstName + lastName
ALTER TABLE "User" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';

-- Backfill existing rows: copy name into firstName
UPDATE "User" SET "firstName" = "name" WHERE "firstName" = '';

-- Drop the old name column
ALTER TABLE "User" DROP COLUMN "name";

-- Remove defaults (schema has no default)
ALTER TABLE "User" ALTER COLUMN "firstName" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "lastName" DROP DEFAULT;
