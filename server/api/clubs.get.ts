export default defineEventHandler(async () => {
  return prisma.club.findMany({
    orderBy: { updatedAt: 'desc' },
  });
});
