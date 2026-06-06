import type { Meilisearch, Settings } from 'meilisearch';

/** The single global index holding every published entry across all content types. */
export const ENTRIES_INDEX = 'entries';

/**
 * Resolve the entries index name for the current process. Defaults to
 * ENTRIES_INDEX (`entries`). The integration test suite overrides it to
 * `entries_test` via the MEILI_INDEX env var (set in vitest.config.ts) so a
 * `pnpm test` run never clobbers the dev `entries` index on the shared local
 * Meilisearch container. Mirrors getTestDatabaseUrl()'s env-with-fallback
 * pattern (`||`, not `??`, so an empty string also falls back). Read on every
 * call (no caching) so the override is always honoured.
 */
export function resolveEntriesIndex(): string {
  return process.env.MEILI_INDEX || ENTRIES_INDEX;
}

/**
 * Skeleton index configuration. Downstream issues expand these per
 * content-type field: #222 (transformer) defines the document shape, #225
 * (sync) populates it, #227 (query API) reads it. This establishes the
 * baseline so the index exists with sane defaults:
 *
 * - searchableAttributes: entryTitle only (highest-priority text field).
 * - filterableAttributes: contentType (cross-type query scoping) + entryKey
 *   (exact-match lookups).
 * - sortableAttributes: publishedAt.
 * - rankingRules: Meilisearch's documented defaults, set explicitly so the
 *   baseline is self-describing for downstream tuning.
 */
export const ENTRIES_INDEX_SETTINGS: Settings = {
  searchableAttributes: ['entryTitle'],
  filterableAttributes: ['contentType', 'entryKey'],
  sortableAttributes: ['publishedAt'],
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',
    'exactness',
  ],
};

/**
 * Create the global `entries` index if absent and converge its settings to
 * ENTRIES_INDEX_SETTINGS. Idempotent — safe to call on every boot.
 *
 * Existence is checked via getIndexes membership rather than catching a
 * `MeilisearchApiError` with an `index_not_found` code, to avoid coupling to
 * the SDK's error-shape (which has changed across versions). boject-cms is
 * single-tenant with one global index, so the index count is tiny and a single
 * getIndexes call with a generous limit never paginates.
 */
export async function ensureEntriesIndex(
  client: Meilisearch,
  index: string = resolveEntriesIndex()
): Promise<void> {
  const { results } = await client.getIndexes({ limit: 1000 });
  const exists = results.some((i) => i.uid === index);

  if (!exists) {
    await client.createIndex(index, { primaryKey: 'id' }).waitTask();
  }

  await client.index(index).updateSettings(ENTRIES_INDEX_SETTINGS).waitTask();
}
