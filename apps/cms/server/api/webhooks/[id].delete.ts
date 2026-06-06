import { assertUuid } from '../../utils/validation';
import { isCmsRequest } from '../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const webhook = await prisma.webhook.findUnique({
    where: { id },
    select: { kind: true },
  });
  if (!webhook) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' });
  }
  if (webhook.kind === 'INTERNAL') {
    throw createError({
      statusCode: 409,
      statusMessage: 'The internal search-sync webhook cannot be deleted',
    });
  }

  await prisma.webhook.delete({ where: { id } });
  return { success: true };
});
