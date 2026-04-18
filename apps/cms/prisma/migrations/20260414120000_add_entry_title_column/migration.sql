-- Add entryTitle column; backfill from data JSONB using the content type's ENTRY_TITLE field
ALTER TABLE "ContentEntry" ADD COLUMN "entryTitle" TEXT;

-- Backfill: resolve the ENTRY_TITLE field identifier per content type, then copy the value from data
UPDATE "ContentEntry" e
SET "entryTitle" = COALESCE(NULLIF(e.data ->> f.identifier, ''), 'Untitled')
FROM "ContentTypeField" f
WHERE f."contentTypeId" = e."contentTypeId"
  AND f.type = 'ENTRY_TITLE';

-- Fail the migration if any row is still null (no ENTRY_TITLE field configured — should not happen)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ContentEntry" WHERE "entryTitle" IS NULL) THEN
    RAISE EXCEPTION 'ContentEntry rows without entryTitle after backfill — check that all content types have an ENTRY_TITLE field';
  END IF;
END $$;

-- Fail the migration if duplicates exist (user must resolve manually)
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT "contentTypeId", "entryTitle"
    FROM "ContentEntry"
    GROUP BY "contentTypeId", "entryTitle"
    HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Duplicate (contentTypeId, entryTitle) pairs found — resolve duplicates before applying this migration';
  END IF;
END $$;

ALTER TABLE "ContentEntry" ALTER COLUMN "entryTitle" SET NOT NULL;

CREATE UNIQUE INDEX "ContentEntry_contentTypeId_entryTitle_key"
  ON "ContentEntry"("contentTypeId", "entryTitle");
