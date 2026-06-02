// Shared test-support builders for content-bundle fixtures. NOT a test file
// (no *.test.ts glob match) and NOT vendored. Builders are typed against the
// canonical ./types so a single Bundle-typed builder serves every consumer.
//
// Defaults reproduce the most common inline literal exactly; deviations are
// expressed via overrides or build-then-mutate at the call site. Parity with
// the original literals is proven per-fixture with a temporary toStrictEqual
// assertion during extraction.
import type { ContentStatus, FieldType } from '#prisma';
import type {
  Bundle,
  BundleContentType,
  BundleEntry,
  BundleEntryVersion,
  BundleField,
} from './types';
import { BUNDLE_VERSION } from './types';
import type { CurrentSchemaSnapshot } from './schemaPlan.types';

/** The single canonical timestamp used across content-bundle fixtures. */
export const FIXED_EXPORTED_AT = '2026-05-01T00:00:00.000Z';

export function makeBundle(parts: Partial<Bundle> = {}): Bundle {
  return {
    version: BUNDLE_VERSION,
    exportedAt: FIXED_EXPORTED_AT,
    portable: true,
    ...parts,
  };
}

/**
 * A CurrentSchemaSnapshot. `contentTypes` defaults to `[]`; `fieldUsage` to an
 * empty Map. Pass a ready Map for `fieldUsage` — it is a Map, not an object,
 * and `toStrictEqual` enforces that distinction. Snapshot content-type fields
 * are a DIFFERENT shape than BundleField (required `id`/`unique`, an
 * `entryCount` on the type), so build them with literals or a local snapshot
 * helper — the bundle `field()`/`ct()` builders do NOT fit here.
 */
export function snapshot(
  parts: Partial<CurrentSchemaSnapshot> = {}
): CurrentSchemaSnapshot {
  return { contentTypes: [], fieldUsage: new Map(), ...parts };
}

export function ct(
  identifier: string,
  overrides: Partial<Omit<BundleContentType, 'identifier' | 'fields'>> = {},
  fields: BundleField[] = []
): BundleContentType {
  return {
    id: null,
    identifier,
    name: identifier,
    description: null,
    ...overrides,
    fields,
  };
}

/**
 * A BundleField. `unique` is intentionally omitted by default (it is optional
 * on the type and most literals omit it) — `toStrictEqual` treats absent and
 * `false` as different, so only pass `{ unique }` when the original sets it.
 *
 * `order` defaults to 0: set it explicitly (`{ order: 1 }`, ...) on every field
 * beyond the first in a content type, or you get two `order: 0` fields — a
 * silently-malformed fixture.
 */
export function field(
  identifier: string,
  type: FieldType,
  overrides: Partial<Omit<BundleField, 'identifier' | 'type'>> = {}
): BundleField {
  return {
    id: null,
    identifier,
    name: identifier,
    type,
    required: false,
    order: 0,
    options: null,
    ...overrides,
  };
}

/**
 * A BundleEntryVersion. `data` defaults to `{}` and `publishedAt` to `null` —
 * the common DRAFT shape. Pass `{ data }` for content and `{ publishedAt }`
 * for PUBLISHED versions; `toStrictEqual` distinguishes absent from `null`, so
 * always supply `publishedAt` when the original literal sets a timestamp.
 */
export function version(
  status: ContentStatus,
  overrides: Partial<Omit<BundleEntryVersion, 'status'>> = {}
): BundleEntryVersion {
  return { status, data: {}, publishedAt: null, ...overrides };
}

/**
 * A BundleEntry. `id`/`contentTypeId`/`slug` default to `null` (the portable
 * shape — non-portable bundles carry real UUIDs, so pass `{ id, contentTypeId }`
 * there). `entryTitle` defaults to `entryKey`; override it when the literal's
 * title differs from its key (most do, e.g. title `'News'` / key `'news'`).
 * `versions` defaults to `[]` — pass `{ versions: [version(...)] }`.
 */
export function entry(
  contentTypeIdentifier: string,
  entryKey: string,
  overrides: Partial<
    Omit<BundleEntry, 'contentTypeIdentifier' | 'entryKey'>
  > = {}
): BundleEntry {
  return {
    id: null,
    contentTypeId: null,
    contentTypeIdentifier,
    entryTitle: entryKey,
    entryKey,
    slug: null,
    versions: [],
    ...overrides,
  };
}
