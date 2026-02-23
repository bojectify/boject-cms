export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const club = await prisma.club.findUnique({ where: { id } });
  if (!club) {
    throw createError({ statusCode: 404, statusMessage: 'Club not found' });
  }
  return club;
});
