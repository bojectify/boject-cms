-- Rename columns: name → identifier, label → name
ALTER TABLE "ContentTypeField" RENAME COLUMN "name" TO "identifier";
ALTER TABLE "ContentTypeField" RENAME COLUMN "label" TO "name";

-- Rename the unique index to match new column name
ALTER INDEX "ContentTypeField_contentTypeId_name_key" RENAME TO "ContentTypeField_contentTypeId_identifier_key";

-- Helper function to convert snake_case to camelCase
CREATE OR REPLACE FUNCTION _snake_to_camel(input text) RETURNS text AS $$
DECLARE
  result text := input;
  pos int;
BEGIN
  LOOP
    pos := position('_' in result);
    EXIT WHEN pos = 0;
    result := left(result, pos - 1) || upper(substring(result from pos + 1 for 1)) || substring(result from pos + 2);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Update JSONB keys in ContentEntry.data before changing field identifiers
-- For each field with an underscore, rename the old key to the new camelCase key in all entries
DO $$
DECLARE
  field_rec RECORD;
  new_ident text;
BEGIN
  FOR field_rec IN
    SELECT id, "contentTypeId", identifier
    FROM "ContentTypeField"
    WHERE identifier LIKE '%\_%'
  LOOP
    new_ident := _snake_to_camel(field_rec.identifier);

    UPDATE "ContentEntry"
    SET data = (data - field_rec.identifier) || jsonb_build_object(new_ident, data -> field_rec.identifier)
    WHERE "contentTypeId" = field_rec."contentTypeId"
      AND data ? field_rec.identifier;
  END LOOP;
END;
$$;

-- Now update the field identifiers themselves to camelCase
UPDATE "ContentTypeField"
SET identifier = _snake_to_camel(identifier)
WHERE identifier LIKE '%\_%';

-- Clean up helper function
DROP FUNCTION _snake_to_camel(text);
