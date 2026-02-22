export default defineEventHandler(async () => {
  return prisma.team.findMany({
    orderBy: { name: 'asc' },
  });
});
