-- Add entryKey column (nullable for backfill).
ALTER TABLE "ContentEntry" ADD COLUMN "entryKey" TEXT;

-- Backfill via Postgres regex that mirrors apps/cms/utils/slugify.ts exactly.
UPDATE "ContentEntry"
SET "entryKey" = regexp_replace(
  regexp_replace(lower("entryTitle"), '[^a-z0-9]+', '-', 'g'),
  '^-|-$', '', 'g'
);

-- Fail loudly if any backfilled values collide within a content type. Operator
-- must rename one of each pair via the CMS UI before re-running.
DO $$
DECLARE
  conflicts TEXT;
BEGIN
  SELECT string_agg(
    format('  contentTypeId=%I entryKey=%L titles=[%s]',
           "contentTypeId", "entryKey", titles),
    E'\n'
  )
  INTO conflicts
  FROM (
    SELECT "contentTypeId",
           "entryKey",
           string_agg("entryTitle", ', ' ORDER BY "createdAt" ASC) AS titles
    FROM "ContentEntry"
    GROUP BY "contentTypeId", "entryKey"
    HAVING count(*) > 1
  ) c;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION
      E'entryKey backfill produced duplicates. Rename one entryTitle in each set before retrying:\n%',
      conflicts;
  END IF;
END $$;

-- Backfill survived; lock the column down.
ALTER TABLE "ContentEntry" ALTER COLUMN "entryKey" SET NOT NULL;

-- Per-content-type uniqueness.
CREATE UNIQUE INDEX "ContentEntry_contentTypeId_entryKey_key"
  ON "ContentEntry" ("contentTypeId", "entryKey");

-- Defence-in-depth: empty entryKey shouldn't be possible (entryTitle validation
-- rejects empty inputs and slugify only produces empty for all-punctuation
-- titles, which the entry-create endpoint rejects). The CHECK is a backstop.
ALTER TABLE "ContentEntry"
  ADD CONSTRAINT "ContentEntry_entryKey_nonempty_check"
  CHECK (length("entryKey") > 0);
