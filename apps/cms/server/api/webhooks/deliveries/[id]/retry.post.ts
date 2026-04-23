import type { Prisma } from '#prisma';
import { assertUuid } from '../../../../utils/validation';
import { isCmsRequest } from '../../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.retry');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const original = await prisma.webhookDelivery.findUnique({ where: { id } });
  if (!original) {
    throw createError({ statusCode: 404, statusMessage: 'Delivery not found' });
  }

  const requeued = await prisma.webhookDelivery.create({
    data: {
      webhookId: original.webhookId,
      event: original.event,
      contentTypeId: original.contentTypeId,
      entryId: original.entryId,
      payload: original.payload as Prisma.InputJsonValue,
      isTest: original.isTest,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
    },
  });
  setResponseStatus(event, 201);
  return { deliveryId: requeued.id };
});
