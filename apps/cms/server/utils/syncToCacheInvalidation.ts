import { WEBHOOK_EVENTS } from '../../utils/webhookEvents';
import type { TaggedCache } from './taggedCache';

export interface CacheInvalidationDeps {
  cache: Pick<TaggedCache, 'invalidateByTag'>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Translate a WebhookDelivery payload into tag clears on the public cache.
 * Entry events clear the content-type tag AND the per-entry tag; a schema
 * change clears the content-type tag. Throws on cache failure so the
 * (internal-transport) worker records a retry/dead-letter. Unknown /
 * unsubscribed events and malformed payloads are a logged no-op (mirrors
 * syncToSearchIndex). The per-entry clear is a no-op today (no surface writes
 * entry:<Identifier>:<entryId> tags yet) but ready for the single-entry endpoint + GraphQL (#260).
 */
export async function syncToCacheInvalidation(
  { cache }: CacheInvalidationDeps,
  payload: unknown
): Promise<void> {
  const p = asRecord(payload);

  switch (p.event) {
    case WEBHOOK_EVENTS.ENTRY_PUBLISHED:
    case WEBHOOK_EVENTS.ENTRY_UNPUBLISHED:
    case WEBHOOK_EVENTS.ENTRY_DELETED: {
      const identifier = asString(asRecord(p.contentType).identifier);
      const entryId = asString(asRecord(p.entry).id);
      if (!identifier) {
        console.warn(
          '[cache-invalidation] entry event missing contentType.identifier',
          p.event
        );
        return;
      }
      const tags = [`content-type:${identifier}`];
      if (entryId) tags.push(`entry:${identifier}:${entryId}`);
      await Promise.all(tags.map((t) => cache.invalidateByTag(t)));
      console.log(`[cache-invalidation] ${String(p.event)} cleared tags`, tags);
      return;
    }

    case WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED:
    case WEBHOOK_EVENTS.CONTENT_BULK_SYNC: {
      const identifier = asString(p.contentTypeIdentifier);
      if (!identifier) {
        console.warn(
          '[cache-invalidation] schema event missing contentTypeIdentifier'
        );
        return;
      }
      const tag = `content-type:${identifier}`;
      await cache.invalidateByTag(tag);
      console.log(
        '[cache-invalidation] CONTENT_TYPE_SCHEMA_CHANGED cleared tag',
        tag
      );
      return;
    }

    default:
      return;
  }
}
