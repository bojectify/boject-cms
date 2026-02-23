export default defineEventHandler(async () => {
  const competitions = await prisma.competition.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return competitions.map((c) => ({ label: c.name, value: c.id }));
});
