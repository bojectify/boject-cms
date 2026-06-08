import { parseFieldOptions } from '../../utils/fieldOptions';
import type { FieldTypeName } from '../../utils/fieldTypes';
import type {
  QueryContentType,
  QueryField,
} from '../../utils/queryBuilder/types';

interface FieldRow {
  identifier: string;
  name: string;
  type: string;
  options: unknown;
}

interface TypeRow {
  id: string;
  identifier: string;
  name: string;
  fields: FieldRow[];
}

/** Map Prisma content-type + field rows to the palette's QueryContentType[]. */
export function toQueryContentTypes(rows: TypeRow[]): QueryContentType[] {
  return rows.map((row) => ({
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    fields: row.fields.map((f): QueryField => {
      const field: QueryField = {
        identifier: f.identifier,
        name: f.name,
        type: f.type as FieldTypeName,
      };
      try {
        const opts = parseFieldOptions({ type: f.type, options: f.options });
        if (opts.type === 'SELECT') {
          field.choices = opts.choices.map((c) => ({ label: c, value: c }));
        } else if (opts.type === 'RELATION' || opts.type === 'MULTIRELATION') {
          field.targetContentTypeIds = opts.targetContentTypeIds;
        }
      } catch {
        // A single corrupt options row must not 500 the whole palette —
        // fall back to the bare field.
      }
      return field;
    }),
  }));
}
