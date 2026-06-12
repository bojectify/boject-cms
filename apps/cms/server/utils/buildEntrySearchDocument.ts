import type { FieldTypeName } from '../../utils/fieldTypes';
import {
  CONTENT_STATUSES,
  type ContentStatusName,
} from '../../utils/contentStatus';
import {
  toSearchDocument,
  type SearchableFieldDef,
  type SearchDocument,
} from './searchDocument';

/** Versions a doc is built for. ARCHIVED is never indexed. */
export const INDEXABLE_STATUSES: ContentStatusName[] = [
  CONTENT_STATUSES.DRAFT,
  CONTENT_STATUSES.CHANGED,
  CONTENT_STATUSES.PUBLISHED,
];

/**
 * Structural shape both callers (reindex + sync reconcile) load via Prisma: the
 * entry envelope, its content type's fields, and ALL of its DRAFT/CHANGED/
 * PUBLISHED versions.
 */
export interface EntryForSearch {
  id: string;
  entryKey: string;
  contentType: {
    identifier: string;
    fields: { identifier: string; type: FieldTypeName }[];
  };
  versions: {
    entryTitle: string;
    publishedAt: Date | null;
    data: unknown;
    status: ContentStatusName;
  }[];
}

/**
 * Map a loaded entry to one Meilisearch document per indexable version. The
 * "working" version (CHANGED > DRAFT > PUBLISHED) is flagged isWorkingVersion so
 * a plain CMS search returns one hit per entry; the PUBLISHED doc of a two-slot
 * entry is the shadowed one (isWorkingVersion=false) and still serves public/API
 * search via the status=PUBLISHED gate.
 */
export function buildEntrySearchDocuments(
  entry: EntryForSearch
): SearchDocument[] {
  const indexable = entry.versions.filter((v) =>
    INDEXABLE_STATUSES.includes(v.status)
  );
  const working =
    indexable.find((v) => v.status === CONTENT_STATUSES.CHANGED) ??
    indexable.find((v) => v.status === CONTENT_STATUSES.DRAFT) ??
    indexable.find((v) => v.status === CONTENT_STATUSES.PUBLISHED) ??
    null;
  const fields: SearchableFieldDef[] = entry.contentType.fields.map((f) => ({
    identifier: f.identifier,
    type: f.type,
  }));
  return indexable.map((v) =>
    toSearchDocument(
      {
        id: entry.id,
        entryKey: entry.entryKey,
        contentType: entry.contentType.identifier,
        entryTitle: v.entryTitle,
        publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
        status: v.status,
        isWorkingVersion: v === working,
        data: v.data,
      },
      fields
    )
  );
}
