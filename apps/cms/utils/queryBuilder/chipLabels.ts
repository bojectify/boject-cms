import type { FieldTypeName } from '../fieldTypes';
import { FIELD_TYPES } from '../fieldTypes';
import type { SearchFilter, SearchQuery } from './types';
import { operatorLabel } from './operators';
import { getSystemField } from './systemFields';

/** Minimal field shape needed to render a filter chip's labels. */
export interface ChipLabelField {
  identifier: string;
  name: string;
  type: string;
}

/**
 * A field identifier → its display name (falls back to the identifier).
 * System fields (`$entryKey`) resolve via their registry first — the order is
 * just clarity, since a user field identifier can never start with `$`.
 */
export function chipFieldName(
  fields: ChipLabelField[],
  identifier: string
): string {
  return (
    getSystemField(identifier)?.name ??
    fields.find((f) => f.identifier === identifier)?.name ??
    identifier
  );
}

/**
 * A filter's operator id → its display label for the field's type (e.g. eq →
 * "is"). System fields label via their donor type (e.g. $entryKey → SLUG).
 */
export function chipOperatorLabel(
  fields: ChipLabelField[],
  filter: SearchFilter
): string {
  const type =
    getSystemField(filter.field)?.type ??
    fields.find((f) => f.identifier === filter.field)?.type;
  return type ? operatorLabel(type as FieldTypeName, filter.op) : filter.op;
}

/**
 * A filter value → its display string. Relation ids resolve to a captured title
 * via `relationLabels` (falling back to the id); arrays (list ops) map each
 * element and join with ", "; null/undefined and empty arrays yield null (the
 * chip hides its value segment).
 */
export function chipValueDisplay(
  value: unknown,
  relationLabels?: Record<string, string>
): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value
      .map((v) => relationLabels?.[String(v)] ?? String(v))
      .join(', ');
  }
  const key = String(value);
  return relationLabels?.[key] ?? key;
}

/** True for RELATION / MULTIRELATION field types (their filter value is an entry id). */
export function isRelationFieldType(type: string): boolean {
  return type === FIELD_TYPES.RELATION || type === FIELD_TYPES.MULTIRELATION;
}

/**
 * Unique entry ids referenced by a query's RELATION/MULTIRELATION filters.
 * Equality filters store a single id string per filter; list operators
 * (containsAny/All) store an array of id strings — both are collected here.
 */
export function collectRelationFilterIds(
  query: SearchQuery | undefined,
  fields: ChipLabelField[]
): string[] {
  if (!query) return [];
  const seen = new Set<string>();
  for (const f of query.filters) {
    const type = fields.find((x) => x.identifier === f.field)?.type;
    if (!type || !isRelationFieldType(type)) continue;
    if (typeof f.value === 'string' && f.value) {
      seen.add(f.value);
    } else if (Array.isArray(f.value)) {
      for (const v of f.value) {
        if (typeof v === 'string' && v) seen.add(v);
      }
    }
  }
  return [...seen];
}
