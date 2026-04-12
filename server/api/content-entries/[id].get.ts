export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      contentType: {
        include: { fields: { orderBy: { order: 'asc' } } },
      },
    },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }
  return entry;
});
