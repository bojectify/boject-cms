import type { Prisma } from '#prisma';
import {
  assertUuid,
  assertStringLength,
  assertIdentifier,
} from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const NAME_MAX = 200;

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-types.put');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.contentType.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }

  const data: Prisma.ContentTypeUpdateInput = {};
  if ('name' in body)
    data.name = assertStringLength(body.name, 'name', NAME_MAX);
  if ('identifier' in body)
    data.identifier = assertIdentifier(body.identifier, 'identifier');
  if ('description' in body)
    data.description =
      typeof body.description === 'string' ? body.description : null;

  return await withPrismaErrors(
    () =>
      prisma.contentType.update({
        where: { id },
        data,
        include: {
          fields: { orderBy: { order: 'asc' } },
          _count: { select: { entries: true } },
        },
      }),
    {
      uniqueMessage:
        'A content type with this name or identifier already exists',
    }
  );
});
