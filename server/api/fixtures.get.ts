export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.max(1, Number(query.perPage) || 15);

  const [items, total] = await Promise.all([
    prisma.fixture.findMany({
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.fixture.count(),
  ]);

  return { items, total };
});
