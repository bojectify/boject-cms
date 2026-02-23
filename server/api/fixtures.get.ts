export default defineEventHandler(async () => {
  return prisma.fixture.findMany({
    orderBy: { updatedAt: 'desc' },
  });
});
