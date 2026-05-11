import type { BundleEntry } from '../vendor/contentBundleTypes.js';
import type { GeneratedSeed } from './generate.js';
import { rewriteSyntheticIds } from './rewriteSyntheticIds.js';
import {
  SeedMostlyDuplicateError,
  SEED_DUPLICATE_THRESHOLD,
} from './seedErrors.js';

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
): Promise<{ inserted: number; skipped: number }> {
  const batchSize = opts.batchSize ?? 500;
  const idMap = new Map<string, string>(); // synthetic → real (== synthetic for SQL writer)
  let inserted = 0;
  let skipped = 0;

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
      const { insertedIds } = await insertEnvelopes(
        client,
        slice,
        contentTypeId
      );
      const survivors = slice.filter((e) => e.id && insertedIds.has(e.id));
      const skippedInBatch = slice.length - survivors.length;
      skipped += skippedInBatch;
      await insertVersions(client, survivors, idMap);
      // idMap is populated AFTER each slice's version insert, not before.
      // This is safe because the SQL writer's synthetic id == real id (we pass
      // the synthetic UUID as the actual primary key). Cross-slice / cross-group
      // references inside a slice's data therefore resolve correctly even though
      // they're "not yet in the map" — the rewrite at insertVersions falls
      // through, the original id is preserved, and that id matches the
      // envelope row inserted moments earlier.
      //
      // Only survivors land in idMap; patches referencing skipped entries
      // fall through to UPDATE on a missing row (silent no-op). The 50%
      // threshold backstop below catches the case where this would matter.
      //
      // If a future writer ever rewrites synthetic→real IDs (e.g. via a SERIAL
      // PK), this set call must move BEFORE insertVersions to keep the
      // rewrite resolvable. Test #2 (cross-group ID rewriting) guards the
      // invariant.
      for (const e of survivors) {
        if (!e.id) {
          throw new Error(
            'Bundle entry is missing an id; cannot map for ID rewriting'
          );
        }
        idMap.set(e.id, e.id);
      }
      inserted += survivors.length;
    }
  }

  // Apply patches (deferred-edge updates) after all entries exist
  const patchTs =
    generated.groups[0]?.entries[0]?.versions?.[0]?.publishedAt ??
    new Date().toISOString();
  for (const group of generated.groups) {
    if (!group.patches) continue;
    for (const patch of group.patches) {
      const realEntryId = idMap.get(patch.entryId) ?? patch.entryId;
      const rewritten = rewriteSyntheticIds(
        patch.fieldUpdates,
        idMap
      ) as Record<string, unknown>;
      await applyPatch(client, realEntryId, rewritten, patchTs);
    }
  }

  const total = inserted + skipped;
  if (total > 0 && skipped / total > SEED_DUPLICATE_THRESHOLD) {
    throw new SeedMostlyDuplicateError(inserted, skipped, total);
  }
  return { inserted, skipped };
}

async function insertEnvelopes(
  client: PgClientLike,
  entries: BundleEntry[],
  contentTypeId: string
): Promise<{ insertedIds: Set<string> }> {
  if (entries.length === 0) return { insertedIds: new Set() };
  const valuesPlaceholders: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const e of entries) {
    if (!e.versions?.[0]) {
      throw new Error(
        `Bundle entry ${e.id ?? '<unknown>'} has no versions; refusing to insert envelope`
      );
    }
    const ts = e.versions[0].publishedAt ?? new Date().toISOString();
    valuesPlaceholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
    );
    params.push(e.id, contentTypeId, e.entryTitle, e.slug, ts, ts);
  }
  const result = await client.query(
    `INSERT INTO "ContentEntry" ("id", "contentTypeId", "entryTitle", "slug", "createdAt", "updatedAt") VALUES ${valuesPlaceholders.join(', ')} ON CONFLICT DO NOTHING RETURNING id`,
    params
  );
  const insertedIds = new Set(result.rows.map((r) => (r as { id: string }).id));
  return { insertedIds };
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
    if (!e.versions?.[0]) {
      throw new Error(
        `Bundle entry ${e.id ?? '<unknown>'} has no versions; refusing to insert version`
      );
    }
    const v = e.versions[0];
    const ts = v.publishedAt ?? new Date().toISOString();
    const data = rewriteSyntheticIds(v.data, idMap);
    valuesPlaceholders.push(
      `(gen_random_uuid(), $${p++}, 'PUBLISHED', $${p++}, $${p++}::jsonb, $${p++}, $${p++}, $${p++})`
    );
    params.push(
      e.id,
      e.entryTitle,
      JSON.stringify(data),
      v.publishedAt,
      ts,
      ts
    );
  }
  await client.query(
    `INSERT INTO "ContentEntryVersion" ("id", "entryId", "status", "entryTitle", "data", "publishedAt", "createdAt", "updatedAt") VALUES ${valuesPlaceholders.join(', ')}`,
    params
  );
}

async function applyPatch(
  client: PgClientLike,
  entryId: string,
  fieldUpdates: Record<string, unknown>,
  ts: string
): Promise<void> {
  await client.query(
    `UPDATE "ContentEntryVersion" SET "data" = "data" || $1::jsonb, "updatedAt" = $2 WHERE "entryId" = $3 AND "status" = 'PUBLISHED'`,
    [JSON.stringify(fieldUpdates), ts, entryId]
  );
}
