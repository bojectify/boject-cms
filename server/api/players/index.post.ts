import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.firstName || typeof body.firstName !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'firstName is required',
    });
  }
  if (!body.lastName || typeof body.lastName !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'lastName is required',
    });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.PlayerUncheckedCreateInput = {
    firstName: body.firstName as string,
    lastName: body.lastName as string,
    slug: body.slug as string,
  };
  if ('positionId' in body)
    data.positionId = (body.positionId as string) || undefined;
  if ('bio' in body) data.bio = (body.bio as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.player.create({ data });
    setResponseStatus(event, 201);
    return created;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A player with this slug already exists',
      });
    }
    throw err;
  }
});
