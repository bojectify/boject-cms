import type { PrismaClient, WebhookEvent } from '#prisma';
import { WEBHOOK_EVENTS } from '../../utils/webhookEvents';

export const SEARCH_SYNC_WEBHOOK_NAME = 'Search index sync';

/** The four events the bundled search sync subscribes to. */
export const SEARCH_SYNC_EVENTS: WebhookEvent[] = [
  WEBHOOK_EVENTS.ENTRY_PUBLISHED,
  WEBHOOK_EVENTS.ENTRY_UNPUBLISHED,
  WEBHOOK_EVENTS.ENTRY_DELETED,
  WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED,
];

/**
 * Idempotently ensure exactly one INTERNAL "Search index sync" webhook exists.
 * Identified by (kind = INTERNAL, name). Subsequent boots no-op. url/secret are
 * null (internal deliveries never POST). Converges the event set (a future
 * upgrade may add events) WITHOUT re-enabling a row an operator disabled.
 */
export async function ensureSearchSyncWebhook(
  prisma: PrismaClient
): Promise<void> {
  const existing = await prisma.webhook.findFirst({
    where: { kind: 'INTERNAL', name: SEARCH_SYNC_WEBHOOK_NAME },
  });
  if (existing) {
    await prisma.webhook.update({
      where: { id: existing.id },
      data: { events: SEARCH_SYNC_EVENTS, contentTypeIds: [] },
    });
    return;
  }
  await prisma.webhook.create({
    data: {
      name: SEARCH_SYNC_WEBHOOK_NAME,
      kind: 'INTERNAL',
      url: null,
      secret: null,
      enabled: true,
      contentTypeIds: [],
      events: SEARCH_SYNC_EVENTS,
    },
  });
}
