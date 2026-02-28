import type { ContentStatus, Prisma } from '#prisma';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.max(1, Number(query.perPage) || 15);

  const where: Prisma.FixtureWhereInput = {};

  if (typeof query.teamId === 'string' && query.teamId) {
    where.teamId = query.teamId;
  }
  if (typeof query.opponentId === 'string' && query.opponentId) {
    where.opponentId = query.opponentId;
  }
  if (typeof query.competitionId === 'string' && query.competitionId) {
    where.competitionId = query.competitionId;
  }
  if (typeof query.seasonId === 'string' && query.seasonId) {
    where.seasonId = query.seasonId;
  }
  if (query.isHome === 'true' || query.isHome === 'false') {
    where.isHome = query.isHome === 'true';
  }
  if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
    where.status = query.status as ContentStatus;
  }

  const [items, total] = await Promise.all([
    prisma.fixture.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.fixture.count({ where }),
  ]);

  return { items, total };
});
