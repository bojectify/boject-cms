import type { Index } from 'meilisearch';
import type { PrismaClient } from '#prisma';
import { CONTENT_STATUSES } from '../../utils/contentStatus';
import { WEBHOOK_EVENTS } from '../../utils/webhookEvents';
import { buildEntrySearchDocument } from './buildEntrySearchDocument';
import type { SearchDocument } from './searchDocument';

const SCHEMA_REINDEX_BATCH = 1000;

export interface SyncToSearchIndexDeps {
  prisma: PrismaClient;
  index: Index<SearchDocument>;
}

const ENTRY_INCLUDE = {
  contentType: { include: { fields: true } },
  versions: { where: { status: CONTENT_STATUSES.PUBLISHED }, take: 1 },
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function readEvent(payload: unknown): string | undefined {
  const e = asRecord(payload).event;
  return typeof e === 'string' ? e : undefined;
}
function readEntryId(payload: unknown): string | undefined {
  const id = asRecord(asRecord(payload).entry).id;
  return typeof id === 'string' ? id : undefined;
}
function readContentTypeId(payload: unknown): string | undefined {
  const id = asRecord(payload).contentTypeId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Turn a WebhookDelivery payload into a Meilisearch upsert/delete. Re-reads the
 * entry from the DB (the payload lacks entryKey + field defs). Throws on any DB
 * or Meili error so the worker records a delivery failure (retry / dead-letter).
 * Unknown events are a no-op.
 */
export async function syncToSearchIndex(
  deps: SyncToSearchIndexDeps,
  payload: unknown
): Promise<void> {
  const { prisma, index } = deps;
  const event = readEvent(payload);

  switch (event) {
    case WEBHOOK_EVENTS.ENTRY_PUBLISHED: {
      const entryId = readEntryId(payload);
      if (!entryId) return;
      const entry = await prisma.contentEntry.findUnique({
        where: { id: entryId },
        include: ENTRY_INCLUDE,
      });
      // No published version anymore (raced with unpublish/delete): make sure
      // the index doesn't keep a stale doc.
      if (!entry || entry.versions.length === 0) {
        await index.deleteDocument(entryId).waitTask();
        return;
      }
      await index.addDocuments([buildEntrySearchDocument(entry)]).waitTask();
      return;
    }

    case WEBHOOK_EVENTS.ENTRY_UNPUBLISHED:
    case WEBHOOK_EVENTS.ENTRY_DELETED: {
      const entryId = readEntryId(payload);
      if (!entryId) return;
      await index.deleteDocument(entryId).waitTask();
      return;
    }

    case WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED: {
      const contentTypeId = readContentTypeId(payload);
      if (!contentTypeId) return;
      const entries = await prisma.contentEntry.findMany({
        where: {
          contentTypeId,
          versions: { some: { status: CONTENT_STATUSES.PUBLISHED } },
        },
        include: ENTRY_INCLUDE,
        orderBy: { createdAt: 'asc' },
      });
      const documents = entries.map(buildEntrySearchDocument);
      for (let i = 0; i < documents.length; i += SCHEMA_REINDEX_BATCH) {
        await index
          .addDocuments(documents.slice(i, i + SCHEMA_REINDEX_BATCH))
          .waitTask();
      }
      return;
    }

    default:
      // Unknown / non-search event — no-op.
      return;
  }
}
