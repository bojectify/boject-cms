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
 * Index configuration. Downstream issues expand these per content-type field:
 * #222 (transformer) defines the document shape, #225 (sync) populates it, #227
 * (query API) reads it. This establishes the baseline so the index exists with
 * sane defaults:
 *
 * - searchableAttributes: entryTitle (highest-priority text field) + the nested
 *   `fields` parent (covers every per-field value).
 * - filterableAttributes: contentType (cross-type query scoping) + entryKey
 *   (exact-match lookups) + entryTitle (exact/partial title filters via the
 *   ENTRY_TITLE envelope compile path, #315) + the nested `fields` parent
 *   (covers every per-field value) + status (the editorial DRAFT/CHANGED
 *   filter) + entryId (the `$id` lookup + the per-version document key) +
 *   isWorkingVersion (the CMS working-version-per-entry default).
 * - sortableAttributes: publishedAt.
 * - rankingRules: Meilisearch's documented defaults, set explicitly so the
 *   baseline is self-describing for downstream tuning.
 */
export const ENTRIES_INDEX_SETTINGS: Settings = {
  // `entryTitle` is the highest-priority text field; `fields` makes every
  // per-field value (TEXT/TEXTAREA/RICHTEXT body text, etc.) searchable via
  // Meili's nested-attribute matching — covers any content type's fields with
  // no per-field config. Consumers narrow with `attributesToSearchOn`.
  searchableAttributes: ['entryTitle', 'fields'],
  // `contentType`/`entryKey` for envelope filters; `entryTitle` because
  // ENTRY_TITLE field filters compile to the envelope path (exact/partial
  // title matches — eq/neq/contains/startsWith, #315); `fields` makes every nested
  // field value filterable (RELATION/MULTIRELATION/SELECT/etc.) so `/api/search`
  // can filter `fields.author = "x"`, `fields.tags = "y"` (array membership).
  filterableAttributes: [
    'contentType',
    'entryKey',
    'entryTitle',
    'fields',
    'status',
    'entryId',
    'isWorkingVersion',
  ],
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
 * ENTRIES_INDEX_SETTINGS. Idempotent — safe to call on every boot. Also
 * converges the instance-level `containsFilter` experimental flag (best-effort
 * — a toggle failure is warned, not thrown, so it never blocks the index).
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

  // CONTAINS / STARTS WITH filter operators (used by TEXT/TEXTAREA/SLUG
  // `contains`/`startsWith`) are gated behind this instance-level experimental
  // flag. Wrapped so an engine that disallows the toggle never blocks index
  // convergence — graceful degradation. Until the flag is enabled those
  // operators are valid input but the engine rejects them, so /api/search
  // surfaces a 503 (engine failure), not a 400 (the input itself is fine).
  try {
    await client.updateExperimentalFeatures({ containsFilter: true });
  } catch (error) {
    console.warn(
      '[search] could not enable containsFilter experimental feature; CONTAINS/STARTS WITH filters will be unavailable:',
      error
    );
  }
}
