import { randomBytes } from 'node:crypto';
import type { Prisma, WebhookEvent } from '#prisma';
import {
  buildWebhookPayload,
  buildSchemaChangedPayload,
  buildDraftSyncPayload,
} from './webhookPayload';
import type { WebhookEntrySnapshot } from './webhookPayload';
import { WEBHOOK_EVENTS } from '../../utils/webhookEvents';

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64');
}

export interface EnqueueArgs {
  event: WebhookEvent;
  contentType: { id: string; identifier: string };
  entry: WebhookEntrySnapshot;
}

export interface EnqueueSchemaChangedArgs {
  contentType: { id: string; identifier: string };
}

/**
 * Shared core: find every enabled webhook subscribed to this event/content-type
 * and insert one PENDING WebhookDelivery per match, with a snapshotted payload.
 * `entryId` is null for non-entry events (e.g. schema changes). MUST be called
 * with a Prisma transaction client so the enqueue is atomic with the source
 * mutation. Returns the number of deliveries enqueued.
 */
async function insertDeliveries(
  tx: Prisma.TransactionClient,
  params: {
    event: WebhookEvent;
    contentTypeId: string;
    entryId: string | null;
    buildPayload: (deliveryId: string, now: Date) => object;
  }
): Promise<number> {
  const webhooks = await tx.webhook.findMany({
    where: {
      enabled: true,
      events: { has: params.event },
    },
  });

  // `contentTypeIds: []` means "all content types". Prisma can't express
  // "array is empty OR contains X" cleanly, so filter in-process.
  const matching = webhooks.filter(
    (w) =>
      w.contentTypeIds.length === 0 ||
      w.contentTypeIds.includes(params.contentTypeId)
  );
  if (matching.length === 0) return 0;

  const now = new Date();
  await Promise.all(
    matching.map(async (webhook) => {
      // Create a placeholder to get deliveryId, then serialise the payload with
      // that id inside it, then write the payload back — keeps deliveryId a
      // first-class field in the body.
      const placeholder = await tx.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          event: params.event,
          contentTypeId: params.contentTypeId,
          entryId: params.entryId,
          payload: {},
          status: 'PENDING',
          nextAttemptAt: now,
        },
      });
      const payload = params.buildPayload(placeholder.id, now);
      await tx.webhookDelivery.update({
        where: { id: placeholder.id },
        data: {
          // eslint-disable-next-line no-restricted-syntax -- the payload object lacks the string index signature InputJsonObject requires
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
    })
  );

  return matching.length;
}

/**
 * Enqueue deliveries for an entry lifecycle event (ENTRY_PUBLISHED /
 * ENTRY_UNPUBLISHED / ENTRY_DELETED). Signature unchanged.
 */
export async function enqueueWebhookDeliveries(
  tx: Prisma.TransactionClient,
  args: EnqueueArgs
): Promise<number> {
  return insertDeliveries(tx, {
    event: args.event,
    contentTypeId: args.contentType.id,
    entryId: args.entry.id,
    buildPayload: (deliveryId, now) =>
      buildWebhookPayload({
        event: args.event,
        deliveryId,
        timestamp: now,
        contentType: args.contentType,
        entry: args.entry,
      }),
  });
}

/**
 * Enqueue deliveries for a CONTENT_TYPE_SCHEMA_CHANGED event. No entry is
 * involved, so deliveries carry `entryId: null` and a flat schema payload.
 */
export async function enqueueContentTypeSchemaChanged(
  tx: Prisma.TransactionClient,
  args: EnqueueSchemaChangedArgs
): Promise<number> {
  return insertDeliveries(tx, {
    event: WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED,
    contentTypeId: args.contentType.id,
    entryId: null,
    buildPayload: (deliveryId, now) =>
      buildSchemaChangedPayload({
        deliveryId,
        occurredAt: now,
        contentType: args.contentType,
      }),
  });
}

/**
 * Enqueue an internal search-sync trigger for a draft-side mutation (create
 * draft / save draft / discard / unarchive / draft-only delete). Only the
 * INTERNAL search-sync webhook subscribes to ENTRY_DRAFT_SYNC.
 */
export async function enqueueEntryDraftSync(
  tx: Prisma.TransactionClient,
  args: { contentType: { id: string }; entryId: string }
): Promise<number> {
  return insertDeliveries(tx, {
    event: WEBHOOK_EVENTS.ENTRY_DRAFT_SYNC,
    contentTypeId: args.contentType.id,
    entryId: args.entryId,
    buildPayload: (deliveryId, now) =>
      buildDraftSyncPayload({
        deliveryId,
        occurredAt: now,
        contentTypeId: args.contentType.id,
        entryId: args.entryId,
      }),
  });
}
