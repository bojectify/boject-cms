export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const fixture = await prisma.fixture.findUnique({ where: { id } });
  if (!fixture) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Fixture not found',
    });
  }
  return fixture;
});
