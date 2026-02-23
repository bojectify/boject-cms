export default defineEventHandler(async () => {
  return prisma.season.findMany({
    orderBy: { updatedAt: 'desc' },
  });
});
