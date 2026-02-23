export default defineEventHandler(async () => {
  const teams = await prisma.team.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return teams.map((t) => ({ label: t.name, value: t.id }));
});
