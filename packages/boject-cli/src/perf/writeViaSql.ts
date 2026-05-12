import type { BundleEntry } from '../vendor/contentBundleTypes.js';
import type { GeneratedSeed } from './generate.js';
import {
  findUnresolvedRefs,
  rewriteContentTypeIds,
  rewriteSyntheticIds,
} from './rewriteSyntheticIds.js';
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
  const skippedIds = new Set<string>();

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

      // Cascade-skip filter: drop entries whose version data references any
      // entry we've already skipped this run. Runs BEFORE envelope insert
      // to avoid orphan ContentEntry rows (entries with no ContentEntryVersion).
      const refValid = slice.filter((e) => {
        const data = e.versions?.[0]?.data;
        const unresolved = findUnresolvedRefs(data, idMap);
        return ![...unresolved].some((id) => skippedIds.has(id));
      });
      for (const e of slice) {
        if (!refValid.includes(e) && e.id) skippedIds.add(e.id);
      }
      skipped += slice.length - refValid.length;

      // ON CONFLICT path catches duplicate titles/slugs (the #194 behaviour).
      const { insertedIds } = await insertEnvelopes(
        client,
        refValid,
        contentTypeId
      );
      const survivors = refValid.filter((e) => e.id && insertedIds.has(e.id));
      for (const e of refValid) {
        if (!survivors.includes(e) && e.id) skippedIds.add(e.id);
      }
      skipped += refValid.length - survivors.length;

      await insertVersions(client, survivors, idMap, typeIdByIdentifier);
      // idMap is populated AFTER each slice's version insert, not before.
      // This is safe because the SQL writer's synthetic id == real id (we pass
      // the synthetic UUID as the actual primary key). Cross-slice / cross-group
      // references inside a slice's data therefore resolve correctly even though
      // they're "not yet in the map" — the rewrite at insertVersions falls
      // through, the original id is preserved, and that id matches the
      // envelope row inserted moments earlier.
      //
      // Only survivors land in idMap; cascade-skip + 409-skip both populate
      // skippedIds (used by the next batch's cascade filter and the patches
      // pass below). The 50% threshold backstop still catches runaway skip
      // rates.
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
      // Cascade-skip: if patch target was skipped, the UPDATE would no-op
      // anyway (per #194). Surface the skip in stderr so operators see it.
      if (skippedIds.has(patch.entryId)) {
        process.stderr.write(
          `[perf:seed] skipping patch — target entry ${patch.entryId} was skipped this run\n`
        );
        continue;
      }
      // Cascade-skip: if fieldUpdates reference skipped entries, the UPDATE
      // would succeed at the SQL level (JSONB has no FK) but leave invalid
      // data. Skip with a stderr log.
      const unresolved = findUnresolvedRefs(patch.fieldUpdates, idMap);
      if ([...unresolved].some((id) => skippedIds.has(id))) {
        process.stderr.write(
          `[perf:seed] skipping patch on ${patch.entryId} — fieldUpdates reference skipped entries\n`
        );
        continue;
      }
      const realEntryId = idMap.get(patch.entryId) ?? patch.entryId;
      const rewrittenIds = rewriteSyntheticIds(patch.fieldUpdates, idMap);
      const rewritten = rewriteContentTypeIds(
        rewrittenIds,
        typeIdByIdentifier
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
  idMap: Map<string, string>,
  typeIdByIdentifier: Map<string, string>
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
    const dataWithRealEntryIds = rewriteSyntheticIds(v.data, idMap);
    const data = rewriteContentTypeIds(
      dataWithRealEntryIds,
      typeIdByIdentifier
    );
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
