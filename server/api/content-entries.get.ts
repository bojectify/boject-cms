import type { ContentStatus, Prisma } from '#prisma';
import { assertUuid } from '../utils/validation';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  if (!query.contentTypeId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'contentTypeId is required',
    });
  }
  const contentTypeId = assertUuid(query.contentTypeId, 'contentTypeId');

  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));

  const where: Prisma.ContentEntryWhereInput = { contentTypeId };

  if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
    where.status = query.status as ContentStatus;
  }

  const [items, total] = await Promise.all([
    prisma.contentEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.contentEntry.count({ where }),
  ]);

  return { items, total };
});
