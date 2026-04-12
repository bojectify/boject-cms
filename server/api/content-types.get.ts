export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));

  const [items, total] = await Promise.all([
    prisma.contentType.findMany({
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        _count: { select: { fields: true, entries: true } },
      },
    }),
    prisma.contentType.count(),
  ]);

  return { items, total };
});
