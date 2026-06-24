import type { PrismaClient, WebhookEvent } from '#prisma';
import { WEBHOOK_EVENTS } from '../../utils/webhookEvents';

export const CACHE_INVALIDATION_WEBHOOK_NAME = 'Cache invalidation';

/**
 * The four events cache invalidation subscribes to. Excludes ENTRY_DRAFT_SYNC:
 * the public cache is PUBLISHED-only, so draft activity never affects it.
 */
export const CACHE_INVALIDATION_EVENTS: WebhookEvent[] = [
  WEBHOOK_EVENTS.ENTRY_PUBLISHED,
  WEBHOOK_EVENTS.ENTRY_UNPUBLISHED,
  WEBHOOK_EVENTS.ENTRY_DELETED,
  WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED,
];

/**
 * Idempotently ensure exactly one INTERNAL "Cache invalidation" webhook exists.
 * Identified by (kind = INTERNAL, name). url/secret are null (internal
 * deliveries never POST). Converges the event set WITHOUT re-enabling a row an
 * operator disabled. Mirrors ensureSearchSyncWebhook.
 */
export async function ensureCacheInvalidationWebhook(
  prisma: PrismaClient
): Promise<void> {
  const existing = await prisma.webhook.findFirst({
    where: { kind: 'INTERNAL', name: CACHE_INVALIDATION_WEBHOOK_NAME },
  });
  if (existing) {
    await prisma.webhook.update({
      where: { id: existing.id },
      data: { events: CACHE_INVALIDATION_EVENTS, contentTypeIds: [] },
    });
    return;
  }
  await prisma.webhook.create({
    data: {
      name: CACHE_INVALIDATION_WEBHOOK_NAME,
      kind: 'INTERNAL',
      url: null,
      secret: null,
      enabled: true,
      contentTypeIds: [],
      events: CACHE_INVALIDATION_EVENTS,
    },
  });
}
