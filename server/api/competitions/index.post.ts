import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.CompetitionUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
  };
  if ('seasonId' in body)
    data.seasonId = (body.seasonId as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.competition.create({ data });
    setResponseStatus(event, 201);
    return created;
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
