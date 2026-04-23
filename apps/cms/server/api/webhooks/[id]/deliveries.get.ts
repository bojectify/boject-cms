import { assertUuid } from '../../../utils/validation';
import { isCmsRequest } from '../../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));

  const [items, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.webhookDelivery.count({ where: { webhookId: id } }),
  ]);
  return { items, total };
});
