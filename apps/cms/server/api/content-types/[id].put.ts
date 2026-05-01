import type { Prisma } from '#prisma';
import { assertUuid, assertStringLength } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { invalidateSchema } from '../../graphql/schema';
import { assertSchemaEditable } from '../../utils/schemaReadOnly';

const NAME_MAX = 200;

export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
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

  if ('identifier' in body && body.identifier !== existing.identifier) {
    throw createError({
      statusCode: 400,
      statusMessage: 'identifier cannot be changed',
    });
  }

  const data: Prisma.ContentTypeUpdateInput = {};
  if ('name' in body)
    data.name = assertStringLength(body.name, 'name', NAME_MAX);
  if ('description' in body)
    data.description =
      typeof body.description === 'string' ? body.description : null;

  const updated = await withPrismaErrors(
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

  invalidateSchema();

  return updated;
});
