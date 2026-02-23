export default defineEventHandler(async () => {
  return prisma.player.findMany({
    orderBy: { updatedAt: 'desc' },
  });
});
