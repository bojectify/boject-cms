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
      statusMessage:
        'The internal search-sync webhook is managed by boject and cannot be rotated',
    });
  }

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
