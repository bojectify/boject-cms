import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';
import { assertUuid, assertStringLength } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';

const NAME_MAX = 200;

export default defineEventHandler(async (event) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.navigation.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation not found',
    });
  }

  const data: Prisma.NavigationUncheckedUpdateInput = {};
  if ('name' in body) {
    const name = assertStringLength(body.name, 'name', NAME_MAX);
    data.name = name;
    data.entryTitle = name;
  }
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  return await withPrismaErrors(
    () =>
      prisma.navigation.update({
        where: { id },
        data,
        include: {
          items: {
            where: { parentId: null },
            orderBy: { order: 'asc' },
            include: {
              link: { include: { article: true } },
              children: {
                orderBy: { order: 'asc' },
                include: { link: { include: { article: true } } },
              },
            },
          },
        },
      }),
    {
      uniqueMessage: 'A navigation with this name already exists',
      notFoundMessage: 'Navigation not found',
    }
  );
});
