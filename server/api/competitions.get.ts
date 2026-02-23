export default defineEventHandler(async () => {
  return prisma.competition.findMany({
    orderBy: { updatedAt: 'desc' },
  });
});
