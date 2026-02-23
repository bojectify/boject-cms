import type { Prisma } from '../../../generated/prisma/client';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.player.findUnique({ where: { id } });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Player not found' });
  }

  const data: Prisma.PlayerUncheckedUpdateInput = {};
  if ('firstName' in body) data.firstName = body.firstName as string;
  if ('lastName' in body) data.lastName = body.lastName as string;
  if ('positionId' in body)
    data.positionId = (body.positionId as string) || undefined;
  if ('bio' in body) data.bio = (body.bio as string) || undefined;
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  try {
    return await prisma.player.update({ where: { id }, data });
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
