export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) {
    throw createError({ statusCode: 404, statusMessage: 'Team not found' });
  }
  return team;
});
