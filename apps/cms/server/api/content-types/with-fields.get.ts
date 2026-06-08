import { isCmsRequest } from '../../utils/resolveVersion';
import { toQueryContentTypes } from '../../utils/toQueryContentTypes';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({
      statusCode: 403,
      message: 'Forbidden',
    });
  }

  const rows = await prisma.contentType.findMany({
    orderBy: { name: 'asc' },
    include: { fields: { orderBy: { order: 'asc' } } },
  });

  return { items: toQueryContentTypes(rows) };
});
