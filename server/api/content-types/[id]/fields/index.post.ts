import type { FieldType } from '#prisma';
import {
  assertUuid,
  assertStringLength,
  assertFieldIdentifier,
} from '../../../../utils/validation';
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
  enforceMutationRateLimit(event, 'content-type-fields.post');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  // Validate field identifier and name
  const fieldIdentifier = assertFieldIdentifier(body.identifier, 'identifier');
  const name = assertStringLength(body.name, 'name', 200);

  if (typeof body.type !== 'string' || !VALID_FIELD_TYPES.has(body.type)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'type must be a valid FieldType',
    });
  }
  const type = body.type as FieldType;

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
    type === 'ENTRY_TITLE' &&
    contentType.fields.some((f) => f.type === 'ENTRY_TITLE')
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content type already has an ENTRY_TITLE field',
    });
  }
  if (type === 'SLUG' && contentType.fields.some((f) => f.type === 'SLUG')) {
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

  const created = await withPrismaErrors(
    () =>
      prisma.contentTypeField.create({
        data: {
          contentTypeId,
          identifier: fieldIdentifier,
          name,
          type,
          required: typeof body.required === 'boolean' ? body.required : false,
          order: maxOrder + 1,
          options: body.options ?? undefined,
        },
      }),
    {
      uniqueMessage:
        'A field with this identifier already exists on this content type',
    }
  );

  setResponseStatus(event, 201);
  return created;
});
