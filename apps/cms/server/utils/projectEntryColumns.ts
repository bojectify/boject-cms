import { FIELD_TYPES, type FieldTypeName } from '../../utils/fieldTypes';
import { datetimeToEpoch, relationEntryId } from './searchDocument';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Project a browse entry's raw JSONB `data` to the SAME field representation the
 * Meili search index stores (so the data grid renders identically in browse +
 * search): DATETIME → epoch-ms, RELATION → bare target entryId, MULTIRELATION →
 * entryId[], and scalars strictly coerced to match the index — TEXT/SLUG/SELECT →
 * string or null, NUMBER → finite number or null, BOOLEAN → boolean or null.
 * Relation cells are upgraded to { entryId, entryTitle } later by
 * hydrateRelationColumns. Missing / malformed values degrade (null / []), never
 * throw. This MUST stay in lockstep with toSearchDocument's per-type coercion.
 */
export function projectEntryDataColumns(
  data: unknown,
  columns: string[],
  fieldTypes: Record<string, FieldTypeName>
): Record<string, unknown> {
  const src = asObject(data);
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    const value = src[col];
    switch (fieldTypes[col]) {
      case FIELD_TYPES.DATETIME:
        out[col] = datetimeToEpoch(value);
        break;
      case FIELD_TYPES.NUMBER:
        out[col] =
          typeof value === 'number' && Number.isFinite(value) ? value : null;
        break;
      case FIELD_TYPES.BOOLEAN:
        out[col] = typeof value === 'boolean' ? value : null;
        break;
      case FIELD_TYPES.RELATION:
        out[col] = relationEntryId(value);
        break;
      case FIELD_TYPES.MULTIRELATION:
        out[col] = Array.isArray(value)
          ? value.map(relationEntryId).filter((id): id is string => id !== null)
          : [];
        break;
      default:
        // TEXT / SLUG / SELECT — string-shaped. (TEXTAREA / RICHTEXT / ENTRY_TITLE
        // / IMAGE are non-columnable and filtered out upstream.)
        out[col] = typeof value === 'string' ? value : null;
        break;
    }
  }
  return out;
}
