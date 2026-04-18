ALTER TABLE "ContentTypeField" ADD COLUMN "unique" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ContentTypeField" SET "unique" = true WHERE "type" IN ('ENTRY_TITLE', 'SLUG');
