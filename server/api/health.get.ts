export default defineEventHandler(async () => {
  await prisma.$queryRaw`SELECT 1`;

  return {
    status: 'ok',
    database: 'connected',
  };
});
