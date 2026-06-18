-- Keyset covering indexes for cursor pagination (#265).
-- Per-type admin/public list ordering: WHERE contentTypeId = ? ORDER BY updatedAt DESC, id ASC
CREATE INDEX "ContentEntry_contentTypeId_updatedAt_id_idx"
  ON "ContentEntry" ("contentTypeId", "updatedAt" DESC, "id");

-- Cross-type All Content ordering: ORDER BY updatedAt DESC, id ASC (no contentTypeId)
CREATE INDEX "ContentEntry_updatedAt_id_idx"
  ON "ContentEntry" ("updatedAt" DESC, "id");

-- fetchDisplayVersions: WHERE entryId IN (...) DISTINCT ON (entryId, status) ORDER BY entryId, status, updatedAt DESC, id
CREATE INDEX "ContentEntryVersion_entryId_status_updatedAt_id_idx"
  ON "ContentEntryVersion" ("entryId", "status", "updatedAt" DESC, "id");
