import { prisma } from './prisma';
import { FIELD_TYPES, type FieldTypeName } from '../../utils/fieldTypes';
import type { SearchHit } from './searchEntries';

/** A title fetcher: entry ids → Map(id → entryTitle). */
export type TitleFetcher = (ids: string[]) => Promise<Map<string, string>>;

/** Collect deduped target entry ids across all hits for the RELATION/MULTIRELATION columns. */
export function collectRelationColumnIds(
  hits: SearchHit[],
  columns: string[],
  fieldTypes: Record<string, FieldTypeName>
): string[] {
  const ids = new Set<string>();
  for (const hit of hits) {
    const fields = hit.fields;
    if (!fields) continue;
    for (const col of columns) {
      const type = fieldTypes[col];
      const value = fields[col];
      if (type === FIELD_TYPES.RELATION) {
        if (typeof value === 'string' && value !== '') ids.add(value);
      } else if (type === FIELD_TYPES.MULTIRELATION) {
        if (Array.isArray(value)) {
          for (const v of value)
            if (typeof v === 'string' && v !== '') ids.add(v);
        }
      }
    }
  }
  return [...ids];
}

/** Batch-load entry titles by id (the default fetcher used by the API handlers). */
export const fetchEntryTitles: TitleFetcher = async (ids) => {
  if (ids.length === 0) return new Map();
  const rows = await prisma.contentEntry.findMany({
    where: { id: { in: ids } },
    select: { id: true, entryTitle: true },
  });
  return new Map(rows.map((r) => [r.id, r.entryTitle]));
};

/**
 * In-place upgrade of RELATION/MULTIRELATION column cells from raw entry id(s)
 * to { entryId, entryTitle } via a single batched title lookup per page. Scalar
 * columns are untouched. `fetch` is injected for testing; defaults to Prisma.
 */
export async function hydrateRelationColumns(
  hits: SearchHit[],
  columns: string[],
  fieldTypes: Record<string, FieldTypeName>,
  fetch: TitleFetcher = fetchEntryTitles
): Promise<void> {
  const ids = collectRelationColumnIds(hits, columns, fieldTypes);
  if (ids.length === 0) return;
  const titles = await fetch(ids);
  for (const hit of hits) {
    const fields = hit.fields;
    if (!fields) continue;
    for (const col of columns) {
      const type = fieldTypes[col];
      const value = fields[col];
      if (type === FIELD_TYPES.RELATION) {
        fields[col] =
          typeof value === 'string' && value !== ''
            ? { entryId: value, entryTitle: titles.get(value) ?? null }
            : null;
      } else if (type === FIELD_TYPES.MULTIRELATION) {
        fields[col] = Array.isArray(value)
          ? value
              .filter((v): v is string => typeof v === 'string' && v !== '')
              .map((v) => ({ entryId: v, entryTitle: titles.get(v) ?? null }))
          : [];
      }
    }
  }
}
