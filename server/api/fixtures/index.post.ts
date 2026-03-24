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
  if (!body.kickoff) {
    throw createError({
      statusCode: 400,
      statusMessage: 'kickoff is required',
    });
  }

  const data: Prisma.FixtureUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
    kickoff: new Date(body.kickoff as string),
    venue: (body.venue as string) || '',
    isHome: typeof body.isHome === 'boolean' ? body.isHome : true,
  };
  if ('teamId' in body) data.teamId = (body.teamId as string) || undefined;
  if ('opponentId' in body)
    data.opponentId = (body.opponentId as string) || undefined;
  if ('competitionId' in body)
    data.competitionId = (body.competitionId as string) || undefined;
  if ('seasonId' in body)
    data.seasonId = (body.seasonId as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.fixture.create({ data });
    setResponseStatus(event, 201);
    return created;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A fixture with this slug already exists',
      });
    }
    throw err;
  }
});
