import { prisma } from './prisma';
import type { FieldTypeName } from '../../utils/fieldTypes';

interface FieldTypeRow {
  identifier: string;
  type: string;
}

/** Pure: content-type field rows → { identifier: FieldType } lookup. */
export function toFieldTypeMap(
  fields: FieldTypeRow[]
): Record<string, FieldTypeName> {
  const map: Record<string, FieldTypeName> = {};
  for (const f of fields) map[f.identifier] = f.type as FieldTypeName;
  return map;
}

/**
 * Resolve a content type's field-type map by its PascalCase identifier (the
 * `/api/search` `contentType` value). Returns {} when the identifier is unknown
 * — the compiler then allows only equality (string), preserving #227 back-compat.
 */
export async function resolveContentTypeFieldTypes(
  identifier: string
): Promise<Record<string, FieldTypeName>> {
  const ct = await prisma.contentType.findUnique({
    where: { identifier },
    // Only the fields relation is read — `select` avoids fetching the parent's
    // unused scalar columns (name/description/timestamps).
    select: { fields: { select: { identifier: true, type: true } } },
  });
  return ct ? toFieldTypeMap(ct.fields) : {};
}

/** Like resolveContentTypeFieldTypes but keyed by the content type's UUID id. */
export async function resolveContentTypeFieldTypesById(
  id: string
): Promise<Record<string, FieldTypeName>> {
  const ct = await prisma.contentType.findUnique({
    where: { id },
    select: { fields: { select: { identifier: true, type: true } } },
  });
  return ct ? toFieldTypeMap(ct.fields) : {};
}
