import type { BundleEntry } from '../vendor/contentBundleTypes.js';
import type { GeneratedSeed } from './generate.js';
import { rewriteSyntheticIds } from './rewriteSyntheticIds.js';

export interface PgClientLike {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export class MissingContentTypeError extends Error {
  constructor(public identifier: string) {
    super(
      `Content type "${identifier}" not found in target database. ` +
        `Run "boject schema apply" first.`
    );
    this.name = 'MissingContentTypeError';
  }
}

export interface WriteViaSqlOptions {
  batchSize?: number;
}

/**
 * Bulk-inserts perf seed data into the target database via raw `pg`.
 *
 * For each group in `generated.groups`:
 *   1. Look up the contentTypeId by identifier (one SELECT per group).
 *   2. Insert envelopes (ContentEntry rows) in batches.
 *   3. Insert PUBLISHED versions (ContentEntryVersion rows) in batches.
 *
 * Cross-group RELATION/MULTIRELATION refs are rewritten before insert so
 * dependent groups reference real entry IDs (which, for the SQL writer,
 * are the same synthetic UUIDs since the writer uses them as primary keys).
 *
 * After all groups insert, applies any deferred-edge patches as UPDATE
 * statements on the corresponding PUBLISHED version rows.
 *
 * Caller must reset / truncate the target tables before calling. Schema
 * sync (creating ContentType + ContentTypeField rows) is the caller's
 * responsibility — this writer assumes the schema is already applied.
 */
export async function writeViaSql(
  client: PgClientLike,
  generated: GeneratedSeed,
  opts: WriteViaSqlOptions = {}
): Promise<{ inserted: number }> {
  const batchSize = opts.batchSize ?? 500;
  const idMap = new Map<string, string>(); // synthetic → real (== synthetic for SQL writer)
  let inserted = 0;

  // Resolve contentTypeId for each group identifier
  const typeIdByIdentifier = new Map<string, string>();
  for (const group of generated.groups) {
    const r = await client.query(
      'SELECT id FROM "ContentType" WHERE identifier = $1',
      [group.contentTypeIdentifier]
    );
    const row = r.rows[0] as { id?: string } | undefined;
    if (!row?.id)
      throw new MissingContentTypeError(group.contentTypeIdentifier);
    typeIdByIdentifier.set(group.contentTypeIdentifier, row.id);
  }

  // Insert each group's envelopes + versions in batches
  for (const group of generated.groups) {
    const contentTypeId = typeIdByIdentifier.get(group.contentTypeIdentifier)!;
    for (let start = 0; start < group.entries.length; start += batchSize) {
      const slice = group.entries.slice(start, start + batchSize);
      await insertEnvelopes(client, slice, contentTypeId);
      await insertVersions(client, slice, idMap);
      for (const e of slice) idMap.set(e.id!, e.id!);
      inserted += slice.length;
    }
  }

  // Apply patches (deferred-edge updates) after all entries exist
  for (const group of generated.groups) {
    if (!group.patches) continue;
    for (const patch of group.patches) {
      const realEntryId = idMap.get(patch.entryId) ?? patch.entryId;
      const rewritten = rewriteSyntheticIds(
        patch.fieldUpdates,
        idMap
      ) as Record<string, unknown>;
      await applyPatch(client, realEntryId, rewritten);
    }
  }

  return { inserted };
}

async function insertEnvelopes(
  client: PgClientLike,
  entries: BundleEntry[],
  contentTypeId: string
): Promise<void> {
  if (entries.length === 0) return;
  const valuesPlaceholders: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const e of entries) {
    valuesPlaceholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, NOW(), NOW())`
    );
    params.push(e.id, contentTypeId, e.entryTitle, e.slug);
  }
  await client.query(
    `INSERT INTO "ContentEntry" ("id", "contentTypeId", "entryTitle", "slug", "createdAt", "updatedAt") VALUES ${valuesPlaceholders.join(', ')}`,
    params
  );
}

async function insertVersions(
  client: PgClientLike,
  entries: BundleEntry[],
  idMap: Map<string, string>
): Promise<void> {
  if (entries.length === 0) return;
  const valuesPlaceholders: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const e of entries) {
    const v = e.versions![0]!;
    const data = rewriteSyntheticIds(v.data, idMap);
    valuesPlaceholders.push(
      `(gen_random_uuid(), $${p++}, 'PUBLISHED', $${p++}, $${p++}::jsonb, $${p++}, NOW(), NOW())`
    );
    params.push(e.id, e.entryTitle, JSON.stringify(data), v.publishedAt);
  }
  await client.query(
    `INSERT INTO "ContentEntryVersion" ("id", "entryId", "status", "entryTitle", "data", "publishedAt", "createdAt", "updatedAt") VALUES ${valuesPlaceholders.join(', ')}`,
    params
  );
}

async function applyPatch(
  client: PgClientLike,
  entryId: string,
  fieldUpdates: Record<string, unknown>
): Promise<void> {
  await client.query(
    `UPDATE "ContentEntryVersion" SET "data" = "data" || $1::jsonb, "updatedAt" = NOW() WHERE "entryId" = $2 AND "status" = 'PUBLISHED'`,
    [JSON.stringify(fieldUpdates), entryId]
  );
}
