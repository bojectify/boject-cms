export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const season = await prisma.season.findUnique({ where: { id } });
  if (!season) {
    throw createError({ statusCode: 404, statusMessage: 'Season not found' });
  }
  return season;
});
