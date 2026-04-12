import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-types.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const existing = await prisma.contentType.findUnique({
    where: { id },
    include: { _count: { select: { entries: true } } },
  });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }
  if (existing._count.entries > 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Cannot delete content type with existing entries. Delete all entries first.',
    });
  }

  await withPrismaErrors(() => prisma.contentType.delete({ where: { id } }), {
    notFoundMessage: 'Content type not found',
  });

  return { success: true };
});
