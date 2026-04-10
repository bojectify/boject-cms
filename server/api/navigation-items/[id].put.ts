import { assertUuid, assertNonNegativeInt } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'navigation-items.put');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

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

  const data: {
    order?: number;
    parentId?: string | null;
    linkId?: string;
  } = {};

  if ('order' in body) {
    data.order = assertNonNegativeInt(body.order, 'order');
  }

  if ('linkId' in body) {
    data.linkId = assertUuid(body.linkId, 'linkId');
  }

  if ('parentId' in body) {
    if (body.parentId == null || body.parentId === '') {
      data.parentId = null;
    } else {
      const parentId = assertUuid(body.parentId, 'parentId');

      const parent = await prisma.navigationItem.findUnique({
        where: { id: parentId },
        select: { id: true, navigationId: true, parentId: true },
      });

      if (!parent) {
        throw createError({
          statusCode: 400,
          statusMessage: 'parentId does not exist',
        });
      }

      // H1: parent must belong to the same navigation as the item
      if (parent.navigationId !== existing.navigationId) {
        throw createError({
          statusCode: 400,
          statusMessage: 'parentId does not belong to the same navigation',
        });
      }

      // Two-level depth rule
      if (parent.parentId) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Cannot nest more than two levels deep',
        });
      }

      // Prevent self-parenting
      if (parent.id === id) {
        throw createError({
          statusCode: 400,
          statusMessage: 'An item cannot be its own parent',
        });
      }

      data.parentId = parentId;
    }
  }

  return await withPrismaErrors(
    () =>
      prisma.navigationItem.update({
        where: { id },
        data,
        include: { link: { include: { article: true } } },
      }),
    {
      notFoundMessage: 'Navigation item not found',
      foreignKeyMessage: 'linkId does not exist',
    }
  );
});
