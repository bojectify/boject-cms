export default defineEventHandler(async () => {
  const clubs = await prisma.club.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return clubs.map((c) => ({ label: c.name, value: c.id }));
});
