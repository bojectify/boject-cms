import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
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
    data.name = body.name as string;
    data.entryTitle = body.name as string;
  }
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  try {
    return await prisma.navigation.update({
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
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A navigation with this name already exists',
      });
    }
    throw err;
  }
});
