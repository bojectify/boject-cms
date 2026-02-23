import type { Prisma } from '../../../generated/prisma/client';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.team.findUnique({ where: { id } });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Team not found' });
  }

  const data: Prisma.TeamUncheckedUpdateInput = {};
  if ('name' in body) data.name = body.name as string;
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  try {
    return await prisma.team.update({ where: { id }, data });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A team with this name or slug already exists',
      });
    }
    throw err;
  }
});
