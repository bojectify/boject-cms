import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.title || typeof body.title !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'title is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.ArticleUncheckedCreateInput = {
    title: body.title as string,
    slug: body.slug as string,
  };
  if ('summary' in body) data.summary = (body.summary as string) || undefined;
  if ('body' in body) data.body = body.body as Prisma.InputJsonValue;
  if ('authorId' in body)
    data.authorId = (body.authorId as string) || undefined;
  if ('featuredImageId' in body)
    data.featuredImageId = (body.featuredImageId as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  // Handle tag assignment
  const hasTagIds = 'tagIds' in body && Array.isArray(body.tagIds);

  try {
    const created = await prisma.article.create({
      data: {
        ...data,
        ...(hasTagIds && {
          tags: {
            connect: (body.tagIds as string[]).map((tagId) => ({ id: tagId })),
          },
        }),
      },
      include: { author: true, tags: true, featuredImage: true },
    });
    setResponseStatus(event, 201);
    return created;
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
