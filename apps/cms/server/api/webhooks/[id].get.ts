import { assertUuid } from '../../utils/validation';
import { isCmsRequest } from '../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Webhook management requires a CMS session',
    });
  }
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const webhook = await prisma.webhook.findUnique({
    where: { id },
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
  });
  if (!webhook) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' });
  }
  return webhook;
});
