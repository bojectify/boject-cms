export default defineEventHandler(async () => {
  return prisma.image.findMany({
    orderBy: { updatedAt: 'desc' },
  });
});
