import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'navigation-items.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const query = getQuery(event);
  const navigationId = assertUuid(query.navigationId, 'navigationId');

  const existing = await prisma.navigationItem.findUnique({
    where: { id },
    select: { id: true, navigationId: true },
  });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation item not found',
    });
  }

  // H1: item must belong to the declared navigation
  if (existing.navigationId !== navigationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Navigation item does not belong to the given navigation',
    });
  }

  await withPrismaErrors(
    () => prisma.navigationItem.delete({ where: { id } }),
    { notFoundMessage: 'Navigation item not found' }
  );
  return { success: true };
});
