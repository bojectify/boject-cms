export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) {
    throw createError({ statusCode: 404, statusMessage: 'Player not found' });
  }
  return player;
});
