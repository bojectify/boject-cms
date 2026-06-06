import type { FieldTypeName } from '../../utils/fieldTypes';
import {
  toSearchDocument,
  type SearchableFieldDef,
  type SearchDocument,
} from './searchDocument';

/**
 * Minimal structural shape both callers (the reindex command + the sync
 * handler) load via Prisma: the entry envelope, its content type's fields, and
 * the PUBLISHED version at `versions[0]`. The caller guarantees `versions[0]`
 * is the PUBLISHED version (via a `where: { status: PUBLISHED }, take: 1`
 * include), so the non-null index is safe by construction.
 */
export interface EntryForSearch {
  id: string;
  entryKey: string;
  contentType: {
    identifier: string;
    fields: { identifier: string; type: FieldTypeName }[];
  };
  versions: { entryTitle: string; publishedAt: Date | null; data: unknown }[];
}

/** Map a loaded entry (with its PUBLISHED version) to a Meilisearch document. */
export function buildEntrySearchDocument(
  entry: EntryForSearch
): SearchDocument {
  const version = entry.versions[0]!;
  const fields: SearchableFieldDef[] = entry.contentType.fields.map((f) => ({
    identifier: f.identifier,
    type: f.type,
  }));
  return toSearchDocument(
    {
      id: entry.id,
      entryKey: entry.entryKey,
      contentType: entry.contentType.identifier,
      entryTitle: version.entryTitle,
      publishedAt: version.publishedAt
        ? version.publishedAt.toISOString()
        : null,
      data: version.data,
    },
    fields
  );
}
