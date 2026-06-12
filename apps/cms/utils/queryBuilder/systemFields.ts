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
// NOTE the donor also dictates the compiled literal ENCODING (compileSearchFilter
// routes through the donor's clause builder), so the envelope attribute must be
// indexed in the donor type's representation. e.g. a future $publishedAt cannot
// borrow DATETIME while the envelope publishedAt is an ISO string — DATETIME
// clauses compile epoch-ms literals (see searchDocument.ts::datetimeToEpoch).
//
// The registry is deliberately an ordered array rather than the keyed
// object-const used by fieldTypes.ts: it doubles as the palette's display list,
// stays tiny, and identifier uniqueness/prefixing is pinned by tests.
import { FIELD_TYPES, type FieldTypeName } from '../fieldTypes';
import type { QueryContentType, QueryField } from './types';

export const SYSTEM_FIELD_PREFIX = '$';

export interface SystemField {
  /** Wire token INCLUDING the prefix, e.g. '$status'. */
  identifier: string;
  /** Display name, e.g. 'Status'. */
  name: string;
  /** The Meilisearch envelope attribute the filter compiles to, e.g. 'status'. */
  enginePath: string;
  /** Donor field type whose operators + value-input kind this field reuses. */
  type: FieldTypeName;
  /** SELECT-donor choices (the fixed value set), when applicable. */
  choices?: { label: string; value: string }[];
  /** True when offered before a content type is chosen (cross-type envelope filter). */
  unscoped?: boolean;
}

export const SYSTEM_FIELDS: ReadonlyArray<SystemField> = [
  // Status across types is the headline pre-scope query (bulk-publish workflow).
  // SELECT donor → is / is not / is any of, over the fixed content-status set.
  {
    identifier: '$status',
    name: 'Status',
    enginePath: 'status',
    type: FIELD_TYPES.SELECT,
    unscoped: true,
    choices: [
      { label: 'Draft', value: 'DRAFT' },
      { label: 'Changed', value: 'CHANGED' },
      { label: 'Published', value: 'PUBLISHED' },
    ],
  },
  // Find an entry by its UUID. TEXT donor (`is` is the meaningful op; contains/
  // startsWith are harmless on a UUID). enginePath is the entryId envelope attr.
  {
    identifier: '$id',
    name: 'Entry ID',
    enginePath: 'entryId',
    type: FIELD_TYPES.TEXT,
    unscoped: true,
  },
  // entryKey is slug-shaped (derived via slugify), so SLUG's operators —
  // `is` / `starts with` — match its semantics. Scoped-only: an unscoped
  // entryKey would match ambiguously across types (per-content-type unique).
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
  const field: QueryField = {
    identifier: sys.identifier,
    name: sys.name,
    type: sys.type,
  };
  if (sys.choices) field.choices = sys.choices;
  return field;
}

/**
 * THE field lookup for the palette: a content-type field by identifier, falling
 * back to the system registry (as a QueryField). Shared by the machine
 * (editFilter on a committed/URL-prefilled chip) and the host's pick-field
 * handler so the two resolutions can never drift. The order is just clarity —
 * a user field identifier can never start with `$` (see assertFieldIdentifier).
 */
export function resolveQueryField(
  ct: QueryContentType | undefined,
  identifier: string
): QueryField | undefined {
  const own = ct?.fields.find((f) => f.identifier === identifier);
  if (own) return own;
  const sys = getSystemField(identifier);
  return sys ? toQueryField(sys) : undefined;
}
