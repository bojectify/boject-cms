import { assertUuid } from '../../../../utils/validation';
import { isCmsRequest } from '../../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';

/**
 * Cancel a PENDING webhook delivery. Transitions the row to FAILED with
 * `lastError = 'Cancelled by editor'`. If the delivery is already in a
 * terminal state (SUCCESS / FAILED / DEAD_LETTERED), returns 409
 * ALREADY_COMPLETED.
 *
 * Race note: a tiny window exists where the worker dispatches the row
 * between the user's click and this endpoint's update. If the worker
 * wins, the dispatch goes out and the cancel 409s as ALREADY_COMPLETED.
 * Acceptable for v1.
 */
export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.cancel');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const delivery = await prisma.webhookDelivery.findUnique({ where: { id } });
  if (!delivery) {
    throw createError({ statusCode: 404, statusMessage: 'Delivery not found' });
  }

  if (delivery.status !== 'PENDING') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Delivery is already completed',
      data: { error: 'ALREADY_COMPLETED' },
    });
  }

  const updated = await prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: 'FAILED',
      lastError: 'Cancelled by editor',
      completedAt: new Date(),
      nextAttemptAt: null,
    },
  });
  return updated;
});
