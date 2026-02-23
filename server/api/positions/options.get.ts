export default defineEventHandler(async () => {
  const positions = await prisma.position.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return positions.map((p) => ({ label: p.name, value: p.id }));
});
