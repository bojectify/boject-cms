import type { Prisma } from '../../../generated/prisma/client';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.competition.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Competition not found',
    });
  }

  const data: Prisma.CompetitionUncheckedUpdateInput = {};
  if ('name' in body) data.name = body.name as string;
  if ('seasonId' in body)
    data.seasonId = (body.seasonId as string) || undefined;
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  try {
    return await prisma.competition.update({ where: { id }, data });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A competition with this name or slug already exists',
      });
    }
    throw err;
  }
});
