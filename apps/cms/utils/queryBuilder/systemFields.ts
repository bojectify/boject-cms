// System fields: filterable envelope/system attributes of the search index
// (entryKey, and later $status / entry id — #302) that are NOT ContentTypeFields.
// They live on every entry regardless of content type, so the palette offers
// them alongside the type's own fields and the compiler routes them to their
// envelope attribute instead of `fields.<id>`.
//
// Identifiers carry the `$` prefix on the wire (route + /api/search params).
// The prefix can never collide with a user field identifier — those must match
// `^[a-z][a-zA-Z0-9]*$` (see assertFieldIdentifier), which excludes `$`.
//
// Each system field declares a "donor" `type`: an existing FieldTypeName whose
// operator set (operators.ts) and value-input kind it reuses. Piggybacking the
// donor type means there is no parallel operator registry to keep in sync.
//
// The registry is deliberately an ordered array rather than the keyed
// object-const used by fieldTypes.ts: it doubles as the palette's display list,
// stays tiny, and identifier uniqueness/prefixing is pinned by tests.
import { FIELD_TYPES, type FieldTypeName } from '../fieldTypes';
import type { QueryField } from './types';

export const SYSTEM_FIELD_PREFIX = '$';

export interface SystemField {
  /** Wire token INCLUDING the prefix, e.g. '$entryKey'. */
  identifier: string;
  /** Display name, e.g. 'Entry key'. */
  name: string;
  /** The Meilisearch envelope attribute the filter compiles to, e.g. 'entryKey'. */
  enginePath: string;
  /** Donor field type whose operators + value-input kind this field reuses. */
  type: FieldTypeName;
}

export const SYSTEM_FIELDS: ReadonlyArray<SystemField> = [
  // entryKey is slug-shaped (derived via slugify), so SLUG's operators —
  // `is` / `starts with` — match its semantics.
  {
    identifier: '$entryKey',
    name: 'Entry key',
    enginePath: 'entryKey',
    type: FIELD_TYPES.SLUG,
  },
];

/**
 * True when `id` is a `$`-prefixed string. Prefix-only shape check — an
 * unknown token like '$bogus' returns TRUE; the compiler later 400s unknown
 * tokens via a `getSystemField` miss. Accepts `unknown` and narrows,
 * mirroring `isFieldTypeName` in fieldTypes.ts.
 */
export function isSystemFieldId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(SYSTEM_FIELD_PREFIX);
}

/** Registry lookup by wire identifier (including the prefix). */
export function getSystemField(id: string): SystemField | undefined {
  return SYSTEM_FIELDS.find((f) => f.identifier === id);
}

/**
 * Adapt a system field to the `QueryField` shape the palette consumes, so it
 * can flow through the existing field/operator/value steps unchanged.
 * `enginePath` is intentionally dropped — it is a compiler concern.
 */
export function toQueryField(sys: SystemField): QueryField {
  return { identifier: sys.identifier, name: sys.name, type: sys.type };
}
