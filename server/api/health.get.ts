export default defineEventHandler(async () => {
  const teams = await prisma.team.findMany({
    select: { id: true, name: true },
    take: 5,
  });

  return {
    status: 'ok',
    database: 'connected',
    teamCount: teams.length,
    teams,
  };
});
