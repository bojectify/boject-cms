import type { FieldType } from '#prisma';
import {
  assertUuid,
  assertStringLength,
  assertFieldIdentifier,
} from '../../../../utils/validation';
import { withPrismaErrors } from '../../../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';
import { invalidateSchema } from '../../../../graphql/schema';
import { resolveUniqueFlag } from '../../../../utils/validateFieldUnique';
import { assertSchemaEditable } from '../../../../utils/schemaReadOnly';
import {
  parseFieldOptions,
  getFieldOptionsErrorShape,
} from '../../../../../utils/fieldOptions';
import { FIELD_TYPES, isFieldTypeName } from '../../../../../utils/fieldTypes';
import { enqueueContentTypeSchemaChanged } from '../../../../utils/webhooks';

export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-type-fields.post');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  // Validate field identifier and name
  const fieldIdentifier = assertFieldIdentifier(body.identifier, 'identifier');
  const name = assertStringLength(body.name, 'name', 200);

  if (!isFieldTypeName(body.type)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'type must be a valid FieldType',
    });
  }
  const type = body.type as FieldType;

  // Validate targetContentTypeIds for relation fields
  if (type === FIELD_TYPES.RELATION || type === FIELD_TYPES.MULTIRELATION) {
    let opts;
    try {
      opts = parseFieldOptions({ type, options: body.options });
    } catch (e) {
      const shape = getFieldOptionsErrorShape(e);
      throw createError({
        statusCode: 400,
        statusMessage:
          shape?.code === 'invalid_type'
            ? 'options.targetContentTypeIds must be an array'
            : 'Invalid UUID in targetContentTypeIds (must be UUIDs of existing content types)',
      });
    }
    const ids =
      opts.type === FIELD_TYPES.RELATION ||
      opts.type === FIELD_TYPES.MULTIRELATION
        ? opts.targetContentTypeIds
        : [];
    if (ids.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'options.targetContentTypeIds is required for relation fields and must be a non-empty array',
      });
    }
    const existingCount = await prisma.contentType.count({
      where: { id: { in: ids } },
    });
    if (existingCount !== ids.length) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'One or more targetContentTypeIds do not reference existing content types',
      });
    }
  }

  if (
    type === FIELD_TYPES.RICHTEXT &&
    body.options &&
    typeof body.options === 'object'
  ) {
    let opts;
    try {
      opts = parseFieldOptions({ type, options: body.options });
    } catch (e) {
      const shape = getFieldOptionsErrorShape(e);
      const key = shape?.key ?? 'targetContentTypeIds';
      throw createError({
        statusCode: 400,
        statusMessage:
          shape?.code === 'invalid_type'
            ? `options.${key} must be an array`
            : `Invalid UUID in ${key}`,
      });
    }
    if (
      opts.type === FIELD_TYPES.RICHTEXT &&
      opts.targetContentTypeIds.length > 0
    ) {
      const existingCount = await prisma.contentType.count({
        where: { id: { in: opts.targetContentTypeIds } },
      });
      if (existingCount !== opts.targetContentTypeIds.length) {
        throw createError({
          statusCode: 400,
          statusMessage:
            'One or more targetContentTypeIds do not reference existing content types',
        });
      }
    }
  }

  // Check content type exists and load existing fields
  const contentType = await prisma.contentType.findUnique({
    where: { id: contentTypeId },
    include: { fields: { select: { type: true, order: true } } },
  });
  if (!contentType) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }

  // Check uniqueness of ENTRY_TITLE and SLUG
  if (
    type === FIELD_TYPES.ENTRY_TITLE &&
    contentType.fields.some((f) => f.type === FIELD_TYPES.ENTRY_TITLE)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content type already has an ENTRY_TITLE field',
    });
  }
  if (
    type === FIELD_TYPES.SLUG &&
    contentType.fields.some((f) => f.type === FIELD_TYPES.SLUG)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content type already has a SLUG field',
    });
  }

  // Auto-set order to max + 1
  const maxOrder =
    contentType.fields.length > 0
      ? Math.max(...contentType.fields.map((f) => f.order))
      : -1;

  const uniqueFlag = resolveUniqueFlag(
    type,
    typeof body.unique === 'boolean' ? body.unique : undefined
  );

  const created = await withPrismaErrors(
    () =>
      prisma.$transaction(async (tx) => {
        const field = await tx.contentTypeField.create({
          data: {
            contentTypeId,
            identifier: fieldIdentifier,
            name,
            type,
            required:
              typeof body.required === 'boolean' ? body.required : false,
            unique: uniqueFlag,
            order: maxOrder + 1,
            options: body.options ?? undefined,
          },
        });
        await enqueueContentTypeSchemaChanged(tx, {
          contentType: {
            id: contentType.id,
            identifier: contentType.identifier,
          },
        });
        return field;
      }),
    {
      uniqueMessage:
        'A field with this identifier already exists on this content type',
    }
  );

  invalidateSchema();

  setResponseStatus(event, 201);
  return created;
});
