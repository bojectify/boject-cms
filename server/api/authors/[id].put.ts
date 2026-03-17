import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.author.findUnique({ where: { id } });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Author not found' });
  }

  const data: Prisma.AuthorUncheckedUpdateInput = {};
  if ('name' in body) data.name = body.name as string;
  if ('bio' in body) data.bio = (body.bio as string) || undefined;
  if ('headshotId' in body)
    data.headshotId = (body.headshotId as string) || undefined;
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  // Social links: delete-and-recreate within a transaction
  const hasSocialLinks =
    'socialLinks' in body && Array.isArray(body.socialLinks);

  try {
    if (hasSocialLinks) {
      const links = body.socialLinks as Array<{
        platform: string;
        url: string;
      }>;
      const [, updated] = await prisma.$transaction([
        prisma.authorSocialLink.deleteMany({ where: { authorId: id! } }),
        prisma.author.update({
          where: { id },
          data: {
            ...data,
            socialLinks: {
              createMany: {
                data: links.map((l) => ({
                  platform: l.platform,
                  url: l.url,
                })),
              },
            },
          },
          include: { socialLinks: true },
        }),
      ]);
      return updated;
    }

    return await prisma.author.update({
      where: { id },
      data,
      include: { socialLinks: true },
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'An author with this name or slug already exists',
      });
    }
    throw err;
  }
});
