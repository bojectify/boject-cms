export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');

  const contentType = await prisma.contentType.findUnique({
    where: { id },
    include: {
      fields: { orderBy: { order: 'asc' } },
      _count: { select: { entries: true } },
    },
  });

  if (!contentType) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }

  return contentType;
});
