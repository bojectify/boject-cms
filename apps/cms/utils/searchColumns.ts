import { FIELD_TYPES, type FieldTypeName } from './fieldTypes';

// Content-type field types that can be rendered as a results-table column.
// Object-const source of truth (mirrors fieldTypes.ts). Excludes TEXTAREA +
// RICHTEXT (long free text), IMAGE (not indexed), and ENTRY_TITLE (the always-
// present title column).
export const COLUMNABLE_FIELD_TYPES = {
  TEXT: 'TEXT',
  SLUG: 'SLUG',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  SELECT: 'SELECT',
  DATETIME: 'DATETIME',
  RELATION: 'RELATION',
  MULTIRELATION: 'MULTIRELATION',
} as const;

export type ColumnableFieldType =
  (typeof COLUMNABLE_FIELD_TYPES)[keyof typeof COLUMNABLE_FIELD_TYPES];

const COLUMNABLE_SET: ReadonlySet<string> = new Set(
  Object.values(COLUMNABLE_FIELD_TYPES)
);

export function isColumnableFieldType(
  type: unknown
): type is ColumnableFieldType {
  return typeof type === 'string' && COLUMNABLE_SET.has(type);
}

// Content-type field identifiers are camelCase; reject anything else so a junk /
// system ($-prefixed) token never reaches the engine projection.
const FIELD_ID = /^[a-z][a-zA-Z0-9]*$/;

/** Parse the `?columns=` query value (string, repeated array, or absent) into camelCase ids, de-duplicated. */
export function parseColumnsParam(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  return [
    ...new Set(parts.map((s) => s.trim()).filter((s) => FIELD_ID.test(s))),
  ];
}

/** Serialize active column ids back to the `?columns=` form. */
export function serializeColumns(ids: string[]): string {
  return ids.join(',');
}

/** Keep only the requested ids whose resolved field type is columnable. */
export function filterColumnableColumns(
  requested: string[],
  fieldTypes: Record<string, FieldTypeName>
): string[] {
  return requested.filter((id) => isColumnableFieldType(fieldTypes[id]));
}

/** A hydrated relation cell as the API returns it ({ entryId, entryTitle }). */
function relationTitle(v: unknown): string | null {
  if (v && typeof v === 'object' && 'entryTitle' in v) {
    const t = (v as { entryTitle: unknown }).entryTitle;
    return typeof t === 'string' ? t : null;
  }
  return null;
}

/** The display string for an empty / missing column value (em-dash, U+2014). */
export const EMPTY_CELL = '—';

/**
 * Render a hit's `fields.<id>` value for display. `formatDate` is injected (the
 * browse-table dayjs formatter) so this stays pure + unit-testable. DATETIME is
 * epoch-ms; RELATION/MULTIRELATION are { entryId, entryTitle } cells hydrated by
 * the API. Missing / empty values render as an em-dash.
 */
export function formatColumnValue(
  value: unknown,
  type: FieldTypeName,
  formatDate: (epochMs: number) => string
): string {
  switch (type) {
    case FIELD_TYPES.DATETIME:
      return typeof value === 'number' ? formatDate(value) : EMPTY_CELL;
    case FIELD_TYPES.NUMBER:
      return typeof value === 'number' ? String(value) : EMPTY_CELL;
    case FIELD_TYPES.BOOLEAN:
      return value === true ? 'Yes' : value === false ? 'No' : EMPTY_CELL;
    case FIELD_TYPES.RELATION:
      return relationTitle(value) ?? EMPTY_CELL;
    case FIELD_TYPES.MULTIRELATION: {
      if (!Array.isArray(value)) return EMPTY_CELL;
      const titles = value.map(relationTitle).filter((t): t is string => !!t);
      return titles.length ? titles.join(', ') : EMPTY_CELL;
    }
    default:
      // TEXT / SLUG / SELECT — string-shaped.
      return typeof value === 'string' && value !== '' ? value : EMPTY_CELL;
  }
}
