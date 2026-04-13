import type { FieldType, Prisma } from '#prisma';
import { assertUuid, assertStringLength } from '../../../../utils/validation';
import { withPrismaErrors } from '../../../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';

const VALID_FIELD_TYPES = new Set<string>([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
  'RICHTEXT',
]);

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-type-fields.put');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const fieldId = assertUuid(getRouterParam(event, 'fieldId'), 'fieldId');
  const body = await readBody<Record<string, unknown>>(event);

  // Verify field exists and belongs to this content type
  const field = await prisma.contentTypeField.findUnique({
    where: { id: fieldId },
  });
  if (!field || field.contentTypeId !== contentTypeId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Field not found',
    });
  }

  const data: Prisma.ContentTypeFieldUpdateInput = {};

  if ('name' in body) {
    data.name = assertStringLength(body.name, 'name', 200);
  }
  if ('required' in body) {
    if (typeof body.required !== 'boolean') {
      throw createError({
        statusCode: 400,
        statusMessage: 'required must be a boolean',
      });
    }
    data.required = body.required;
  }
  if ('options' in body) {
    data.options = body.options ?? undefined;
  }

  // If updating type, block if entries exist
  if ('type' in body) {
    if (typeof body.type !== 'string' || !VALID_FIELD_TYPES.has(body.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'type must be a valid FieldType',
      });
    }

    const entryCount = await prisma.contentEntry.count({
      where: { contentTypeId },
    });
    if (entryCount > 0) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'Cannot change field type when entries exist for this content type',
      });
    }

    data.type = body.type as FieldType;
  }

  const updated = await withPrismaErrors(
    () =>
      prisma.contentTypeField.update({
        where: { id: fieldId },
        data,
      }),
    {
      uniqueMessage:
        'A field with this name already exists on this content type',
    }
  );

  return updated;
});
