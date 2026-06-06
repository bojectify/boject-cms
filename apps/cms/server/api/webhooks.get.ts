import { isCmsRequest } from '../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Webhook management requires a CMS session',
    });
  }

  const items = await prisma.webhook.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      url: true,
      enabled: true,
      kind: true,
      contentTypeIds: true,
      events: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return { items };
});
