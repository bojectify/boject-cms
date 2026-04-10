import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.link.findUnique({ where: { id } });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Link not found' });
  }

  const data: Prisma.LinkUncheckedUpdateInput = {};
  if ('label' in body) {
    data.label = body.label as string;
    data.entryTitle = body.label as string;
  }
  if ('url' in body) data.url = (body.url as string) || null;
  if ('articleId' in body) data.articleId = (body.articleId as string) || null;
  if ('openInNewTab' in body) data.openInNewTab = Boolean(body.openInNewTab);
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  return await prisma.link.update({
    where: { id },
    data,
    include: { article: true },
  });
});
