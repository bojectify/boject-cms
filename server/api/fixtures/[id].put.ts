import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.fixture.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Fixture not found',
    });
  }

  const data: Prisma.FixtureUncheckedUpdateInput = {};
  if ('name' in body) data.name = body.name as string;
  if ('kickoff' in body) data.kickoff = new Date(body.kickoff as string);
  if ('venue' in body) data.venue = body.venue as string;
  if ('isHome' in body) data.isHome = body.isHome as boolean;
  if ('teamId' in body) data.teamId = (body.teamId as string) || undefined;
  if ('opponentId' in body)
    data.opponentId = (body.opponentId as string) || undefined;
  if ('competitionId' in body)
    data.competitionId = (body.competitionId as string) || undefined;
  if ('seasonId' in body)
    data.seasonId = (body.seasonId as string) || undefined;
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  try {
    return await prisma.fixture.update({ where: { id }, data });
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
