export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const competition = await prisma.competition.findUnique({ where: { id } });
  if (!competition) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Competition not found',
    });
  }
  return competition;
});
