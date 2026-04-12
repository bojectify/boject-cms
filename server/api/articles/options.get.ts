export default defineEventHandler(async () => {
  const articles = await prisma.article.findMany({
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });
  return articles.map((a) => ({ label: a.title, value: a.id }));
});
