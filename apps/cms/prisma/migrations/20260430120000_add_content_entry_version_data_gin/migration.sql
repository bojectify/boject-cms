CREATE INDEX "ContentEntryVersion_data_gin_idx"
  ON "ContentEntryVersion"
  USING gin ("data" jsonb_path_ops);
