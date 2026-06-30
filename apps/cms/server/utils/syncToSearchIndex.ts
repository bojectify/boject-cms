import type { Index } from 'meilisearch';
import type { PrismaClient } from '#prisma';
import { WEBHOOK_EVENTS } from '../../utils/webhookEvents';
import {
  buildEntrySearchDocuments,
  INDEXABLE_STATUSES,
  type EntryForSearch,
} from './buildEntrySearchDocument';
import { searchDocId, type SearchDocument } from './searchDocument';

const SCHEMA_REINDEX_BATCH = 1000;

export interface SyncToSearchIndexDeps {
  prisma: PrismaClient;
  index: Index<SearchDocument>;
}

const ENTRY_INCLUDE = {
  contentType: { include: { fields: true } },
  versions: { where: { status: { in: INDEXABLE_STATUSES } } },
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
 * Converge the index to an entry's current indexable versions: upsert a doc per
 * present DRAFT/CHANGED/PUBLISHED version and delete any absent status-key.
 * Entry gone → delete all three keys. Idempotent (safe under at-least-once
 * delivery + retries). The single behaviour for publish / unpublish / archive /
 * draft-save / discard / unarchive / delete.
 */
async function reconcileEntry(
  deps: SyncToSearchIndexDeps,
  entryId: string
): Promise<void> {
  const { prisma, index } = deps;
  const allKeys = INDEXABLE_STATUSES.map((s) => searchDocId(entryId, s));
  const entry = await prisma.contentEntry.findUnique({
    where: { id: entryId },
    include: ENTRY_INCLUDE,
  });
  if (!entry) {
    await index.deleteDocuments(allKeys).waitTask();
    return;
  }
  const docs = buildEntrySearchDocuments(entry as EntryForSearch);
  const presentIds = new Set(docs.map((d) => d.id));
  const staleKeys = allKeys.filter((k) => !presentIds.has(k));
  if (docs.length) await index.addDocuments(docs).waitTask();
  if (staleKeys.length) await index.deleteDocuments(staleKeys).waitTask();
}

/**
 * Turn a WebhookDelivery payload into Meilisearch writes. Entry events reconcile
 * the entry's docs; schema changes reindex the type (upsert-only — the version
 * set is unchanged, only field content). Throws on DB/Meili error so the worker
 * records a retry/dead-letter. Unknown events are a no-op.
 */
export async function syncToSearchIndex(
  deps: SyncToSearchIndexDeps,
  payload: unknown
): Promise<void> {
  const { prisma, index } = deps;
  const event = readEvent(payload);

  switch (event) {
    case WEBHOOK_EVENTS.ENTRY_PUBLISHED:
    case WEBHOOK_EVENTS.ENTRY_UNPUBLISHED:
    case WEBHOOK_EVENTS.ENTRY_DELETED:
    case WEBHOOK_EVENTS.ENTRY_DRAFT_SYNC: {
      const entryId = readEntryId(payload);
      if (!entryId) return;
      await reconcileEntry(deps, entryId);
      return;
    }

    case WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED:
    case WEBHOOK_EVENTS.CONTENT_BULK_SYNC: {
      const contentTypeId = readContentTypeId(payload);
      if (!contentTypeId) return;
      const entries = await prisma.contentEntry.findMany({
        where: {
          contentTypeId,
          versions: { some: { status: { in: INDEXABLE_STATUSES } } },
        },
        include: ENTRY_INCLUDE,
        orderBy: { createdAt: 'asc' },
      });
      const documents = entries.flatMap((e) =>
        buildEntrySearchDocuments(e as EntryForSearch)
      );
      for (let i = 0; i < documents.length; i += SCHEMA_REINDEX_BATCH) {
        await index
          .addDocuments(documents.slice(i, i + SCHEMA_REINDEX_BATCH))
          .waitTask();
      }
      return;
    }

    default:
      return;
  }
}
