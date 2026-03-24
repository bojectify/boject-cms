import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.AuthorUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
  };
  if ('bio' in body) data.bio = (body.bio as string) || undefined;
  if ('headshotId' in body)
    data.headshotId = (body.headshotId as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  // Handle social links via nested create
  const hasSocialLinks =
    'socialLinks' in body && Array.isArray(body.socialLinks);
  if (hasSocialLinks) {
    const links = body.socialLinks as Array<{
      platform: string;
      url: string;
    }>;
    data.socialLinks = {
      createMany: {
        data: links.map((l) => ({ platform: l.platform, url: l.url })),
      },
    };
  }

  try {
    const created = await prisma.author.create({
      data,
      include: { socialLinks: true },
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
        statusMessage: 'An author with this name or slug already exists',
      });
    }
    throw err;
  }
});
