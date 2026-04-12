export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const navigationId = query.navigationId as string;

  if (!navigationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'navigationId is required',
    });
  }

  const items = await prisma.navigationItem.findMany({
    where: { navigationId },
    orderBy: { order: 'asc' },
    include: {
      link: { include: { article: true } },
    },
  });

  return { items, total: items.length };
});
