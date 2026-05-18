import { randomBytes } from 'node:crypto';
import type { Prisma, WebhookEvent } from '#prisma';
import { buildWebhookPayload } from './webhookPayload';
import type { WebhookEntrySnapshot } from './webhookPayload';

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64');
}

export interface EnqueueArgs {
  event: WebhookEvent;
  contentType: { id: string; identifier: string };
  entry: WebhookEntrySnapshot;
}

/**
 * Find every enabled webhook subscribed to this event/content-type and insert
 * one PENDING WebhookDelivery per match. MUST be called with a Prisma
 * transaction client so the enqueue is atomic with the source mutation.
 *
 * Returns the number of deliveries enqueued (useful for observability).
 */
export async function enqueueWebhookDeliveries(
  tx: Prisma.TransactionClient,
  args: EnqueueArgs
): Promise<number> {
  const webhooks = await tx.webhook.findMany({
    where: {
      enabled: true,
      events: { has: args.event },
    },
  });

  // `contentTypeIds: []` means "all content types". Prisma can't express
  // "array is empty OR contains X" cleanly, so filter in-process.
  const matching = webhooks.filter(
    (w) =>
      w.contentTypeIds.length === 0 ||
      w.contentTypeIds.includes(args.contentType.id)
  );
  if (matching.length === 0) return 0;

  const now = new Date();
  await Promise.all(
    matching.map(async (webhook) => {
      // Create a placeholder to get deliveryId, then serialise the payload with
      // that id inside it, then write the payload back. Two round-trips inside
      // the caller's transaction — negligible cost, and keeps deliveryId a
      // first-class field in the body.
      const placeholder = await tx.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          event: args.event,
          contentTypeId: args.contentType.id,
          entryId: args.entry.id,
          payload: {},
          status: 'PENDING',
          nextAttemptAt: now,
        },
      });
      const payload = buildWebhookPayload({
        event: args.event,
        deliveryId: placeholder.id,
        timestamp: now,
        contentType: args.contentType,
        entry: args.entry,
      });
      await tx.webhookDelivery.update({
        where: { id: placeholder.id },
        data: {
          // eslint-disable-next-line no-restricted-syntax -- WebhookPayload lacks the string index signature InputJsonObject requires
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
    })
  );

  return matching.length;
}
