import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.label || typeof body.label !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'label is required',
    });
  }

  const hasUrl = 'url' in body && typeof body.url === 'string' && body.url;
  const hasArticleId =
    'articleId' in body && typeof body.articleId === 'string' && body.articleId;
  if (!hasUrl && !hasArticleId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either url or articleId is required',
    });
  }

  const data: Prisma.LinkUncheckedCreateInput = {
    label: body.label as string,
    entryTitle: (body.label as string) || '',
  };
  if (hasUrl) data.url = body.url as string;
  if (hasArticleId) data.articleId = body.articleId as string;
  if ('openInNewTab' in body) data.openInNewTab = Boolean(body.openInNewTab);
  applyContentMetadata(body, data as Record<string, unknown>, null);

  const created = await prisma.link.create({
    data,
    include: { article: true },
  });
  setResponseStatus(event, 201);
  return created;
});
