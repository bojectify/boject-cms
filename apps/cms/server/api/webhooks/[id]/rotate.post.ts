import { assertUuid } from '../../../utils/validation';
import { isCmsRequest } from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { generateWebhookSecret } from '../../../utils/webhooks';
import { withPrismaErrors } from '../../../utils/prismaErrors';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.rotate');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const secret = generateWebhookSecret();
  const updated = await withPrismaErrors(
    () =>
      prisma.webhook.update({
        where: { id },
        data: { secret },
      }),
    { notFoundMessage: 'Webhook not found' }
  );
  return { id: updated.id, secret: updated.secret };
});
