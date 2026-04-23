import { assertUuid } from '../../utils/validation';
import { isCmsRequest } from '../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { withPrismaErrors } from '../../utils/prismaErrors';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  await withPrismaErrors(() => prisma.webhook.delete({ where: { id } }), {
    notFoundMessage: 'Webhook not found',
  });
  return { success: true };
});
