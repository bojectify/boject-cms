import type { FieldTypeName } from '../fieldTypes';
import { FIELD_TYPES } from '../fieldTypes';
import type { SearchFilter, SearchQuery } from './types';
import { operatorLabel } from './operators';

/** Minimal field shape needed to render a filter chip's labels. */
export interface ChipLabelField {
  identifier: string;
  name: string;
  type: string;
}

/** A field identifier → its display name (falls back to the identifier). */
export function chipFieldName(
  fields: ChipLabelField[],
  identifier: string
): string {
  return fields.find((f) => f.identifier === identifier)?.name ?? identifier;
}

/** A filter's operator id → its display label for the field's type (e.g. eq → "is"). */
export function chipOperatorLabel(
  fields: ChipLabelField[],
  filter: SearchFilter
): string {
  const type = fields.find((f) => f.identifier === filter.field)?.type;
  return type ? operatorLabel(type as FieldTypeName, filter.op) : filter.op;
}

/**
 * A filter value → its display string. Relation ids resolve to a captured title
 * via the optional `relationLabels` map; everything else stringifies. Null/
 * undefined yields null (the chip hides its value segment).
 */
export function chipValueDisplay(
  value: unknown,
  relationLabels?: Record<string, string>
): string | null {
  if (value == null) return null;
  const key = String(value);
  return relationLabels?.[key] ?? key;
}

/** True for RELATION / MULTIRELATION field types (their filter value is an entry id). */
export function isRelationFieldType(type: string): boolean {
  return type === FIELD_TYPES.RELATION || type === FIELD_TYPES.MULTIRELATION;
}

/**
 * Unique entry ids referenced by a query's RELATION/MULTIRELATION equality
 * filters. v1 equality stores a single id string per filter; array values
 * (rich containsAny/All operators) are #301 and ignored here.
 */
export function collectRelationFilterIds(
  query: SearchQuery | undefined,
  fields: ChipLabelField[]
): string[] {
  if (!query) return [];
  const seen = new Set<string>();
  for (const f of query.filters) {
    const type = fields.find((x) => x.identifier === f.field)?.type;
    if (
      type &&
      isRelationFieldType(type) &&
      typeof f.value === 'string' &&
      f.value
    ) {
      seen.add(f.value);
    }
  }
  return [...seen];
}
