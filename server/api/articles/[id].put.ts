import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Article not found',
    });
  }

  const data: Prisma.ArticleUncheckedUpdateInput = {};
  if ('title' in body) data.title = body.title as string;
  if ('summary' in body) data.summary = (body.summary as string) || undefined;
  if ('body' in body) data.body = body.body as Prisma.InputJsonValue;
  if ('authorId' in body)
    data.authorId = (body.authorId as string) || undefined;
  if ('featuredImageId' in body)
    data.featuredImageId = (body.featuredImageId as string) || undefined;
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  // Handle tag assignment
  const hasTagIds = 'tagIds' in body && Array.isArray(body.tagIds);

  try {
    return await prisma.article.update({
      where: { id },
      data: {
        ...data,
        ...(hasTagIds && {
          tags: {
            set: (body.tagIds as string[]).map((tagId) => ({ id: tagId })),
          },
        }),
      },
      include: { author: true, tags: true, featuredImage: true },
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'An article with this title or slug already exists',
      });
    }
    throw err;
  }
});
