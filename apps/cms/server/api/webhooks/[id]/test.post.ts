import type { Prisma } from '#prisma';
import { assertUuid } from '../../../utils/validation';
import { isCmsRequest } from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.test');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const webhook = await prisma.webhook.findUnique({ where: { id } });
  if (!webhook) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' });
  }
  if (webhook.kind === 'INTERNAL') {
    throw createError({
      statusCode: 409,
      statusMessage:
        'The internal search-sync webhook is managed by boject and cannot be tested',
    });
  }

  const now = new Date();
  const placeholder = await prisma.webhookDelivery.create({
    data: {
      webhookId: webhook.id,
      event: 'ENTRY_PUBLISHED',
      contentTypeId: '00000000-0000-0000-0000-000000000000',
      entryId: '00000000-0000-0000-0000-000000000000',
      payload: {},
      isTest: true,
      status: 'PENDING',
      nextAttemptAt: now,
    },
  });
  const payload = {
    event: 'ENTRY_PUBLISHED' as const,
    deliveryId: placeholder.id,
    timestamp: now.toISOString(),
    test: true,
    message: 'This is a test delivery from boject-cms',
  };
  await prisma.webhookDelivery.update({
    where: { id: placeholder.id },
    data: { payload: payload as Prisma.InputJsonValue },
  });
  setResponseStatus(event, 201);
  return { deliveryId: placeholder.id, isTest: true };
});
