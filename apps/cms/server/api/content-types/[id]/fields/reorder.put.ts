import { assertUuid, assertNonNegativeInt } from '../../../../utils/validation';
import { withPrismaErrors } from '../../../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';
import { assertSchemaEditable } from '../../../../utils/schemaReadOnly';

const MAX_REORDER_ITEMS = 500;

export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-type-fields.reorder');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<{ fields?: unknown }>(event);

  if (!Array.isArray(body.fields)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fields array is required',
    });
  }

  if (body.fields.length > MAX_REORDER_ITEMS) {
    throw createError({
      statusCode: 400,
      statusMessage: `fields array exceeds max size of ${MAX_REORDER_ITEMS}`,
    });
  }

  const validated: Array<{ id: string; order: number }> = body.fields.map(
    (raw: unknown, idx: number) => {
      if (typeof raw !== 'object' || raw === null) {
        throw createError({
          statusCode: 400,
          statusMessage: `fields[${idx}] must be an object`,
        });
      }
      const item = raw as Record<string, unknown>;
      const id = assertUuid(item.id, `fields[${idx}].id`);
      const order = assertNonNegativeInt(item.order, `fields[${idx}].order`);
      return { id, order };
    }
  );

  // Verify all field IDs belong to this content type
  const ids = validated.map((i) => i.id);
  const existing = await prisma.contentTypeField.findMany({
    where: { id: { in: ids }, contentTypeId },
    select: { id: true },
  });
  if (existing.length !== ids.length) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'One or more fields do not belong to the given content type',
    });
  }

  const updated = await withPrismaErrors(() =>
    prisma.$transaction(
      validated.map((item) =>
        prisma.contentTypeField.update({
          where: { id: item.id },
          data: { order: item.order },
        })
      )
    )
  );

  return updated;
});
