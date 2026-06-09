import type { FieldTypeName } from '../fieldTypes';
import type { SearchFilter } from './types';
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
