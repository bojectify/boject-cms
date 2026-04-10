import { assertUuid, assertNonNegativeInt } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'navigation-items.post');
  const body = await readBody<Record<string, unknown>>(event);

  const navigationId = assertUuid(body.navigationId, 'navigationId');
  const linkId = assertUuid(body.linkId, 'linkId');
  const order = assertNonNegativeInt(body.order ?? 0, 'order');

  let parentId: string | null = null;
  if (body.parentId != null && body.parentId !== '') {
    parentId = assertUuid(body.parentId, 'parentId');

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

    // H1: parent must belong to the same navigation
    if (parent.navigationId !== navigationId) {
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
  }

  const created = await withPrismaErrors(
    () =>
      prisma.navigationItem.create({
        data: {
          navigationId,
          linkId,
          parentId,
          order,
        },
        include: { link: { include: { article: true } } },
      }),
    { foreignKeyMessage: 'navigationId or linkId does not exist' }
  );

  setResponseStatus(event, 201);
  return created;
});
