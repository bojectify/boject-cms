import type { Prisma, WebhookEvent } from '#prisma';
import { assertUuid, assertStringLength } from '../../utils/validation';
import { isCmsRequest } from '../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { assertWebhookUrl } from '../../utils/webhookUrl';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { WEBHOOK_EVENT_NAMES } from '../../../utils/webhookEvents';

const VALID_EVENTS: readonly string[] = WEBHOOK_EVENT_NAMES;

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.put');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const data: Prisma.WebhookUpdateInput = {};
  if ('name' in body) {
    data.name = assertStringLength(body.name, 'name', 200);
  }
  if ('url' in body) {
    await assertWebhookUrl(typeof body.url === 'string' ? body.url : '');
    data.url = body.url as string;
  }
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      throw createError({
        statusCode: 400,
        statusMessage: 'enabled must be boolean',
      });
    }
    data.enabled = body.enabled;
  }
  if ('events' in body) {
    if (!Array.isArray(body.events) || body.events.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'events must be a non-empty array',
      });
    }
    data.events = body.events.map((e, i) => {
      if (typeof e !== 'string' || !VALID_EVENTS.includes(e)) {
        throw createError({
          statusCode: 400,
          statusMessage: `events[${i}] is not a valid WebhookEvent`,
        });
      }
      return e as WebhookEvent;
    });
  }
  if ('contentTypeIds' in body) {
    if (!Array.isArray(body.contentTypeIds)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'contentTypeIds must be an array',
      });
    }
    data.contentTypeIds = body.contentTypeIds.map((ctId, i) => {
      if (typeof ctId !== 'string') {
        throw createError({
          statusCode: 400,
          statusMessage: `contentTypeIds[${i}] must be a string`,
        });
      }
      return ctId;
    });
  }

  const updated = await withPrismaErrors(
    () =>
      prisma.webhook.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          url: true,
          enabled: true,
          contentTypeIds: true,
          events: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    { notFoundMessage: 'Webhook not found' }
  );
  return updated;
});
