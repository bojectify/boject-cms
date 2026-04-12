import type { FieldType } from '#prisma';
import { assertStringLength } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const FIELD_NAME_RE = /^[a-z][a-z0-9_]*$/;

const VALID_FIELD_TYPES = new Set<string>([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
]);

const NAME_MAX = 200;

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-types.post');
  const body = await readBody<Record<string, unknown>>(event);

  const name = assertStringLength(body.name, 'name', NAME_MAX);
  const description =
    typeof body.description === 'string' ? body.description : null;

  if (!Array.isArray(body.fields) || body.fields.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fields array is required and must not be empty',
    });
  }

  const fieldNames = new Set<string>();
  let entryTitleCount = 0;
  let slugCount = 0;

  const fieldsData = body.fields.map((raw: unknown, idx: number) => {
    if (typeof raw !== 'object' || raw === null) {
      throw createError({
        statusCode: 400,
        statusMessage: `fields[${idx}] must be an object`,
      });
    }
    const f = raw as Record<string, unknown>;

    const fieldName = assertStringLength(f.name, `fields[${idx}].name`, 100);
    if (!FIELD_NAME_RE.test(fieldName)) {
      throw createError({
        statusCode: 400,
        statusMessage: `fields[${idx}].name must match /^[a-z][a-z0-9_]*$/`,
      });
    }
    if (fieldNames.has(fieldName)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Duplicate field name: ${fieldName}`,
      });
    }
    fieldNames.add(fieldName);

    const label = assertStringLength(f.label, `fields[${idx}].label`, 200);

    if (typeof f.type !== 'string' || !VALID_FIELD_TYPES.has(f.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: `fields[${idx}].type must be a valid FieldType`,
      });
    }
    const type = f.type as FieldType;

    if (type === 'ENTRY_TITLE') entryTitleCount++;
    if (type === 'SLUG') slugCount++;

    return {
      name: fieldName,
      label,
      type,
      required: typeof f.required === 'boolean' ? f.required : false,
      order: idx,
      options: f.options ?? undefined,
    };
  });

  if (entryTitleCount !== 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Exactly one ENTRY_TITLE field is required',
    });
  }
  if (slugCount > 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At most one SLUG field is allowed',
    });
  }

  const created = await withPrismaErrors(
    () =>
      prisma.contentType.create({
        data: { name, description, fields: { create: fieldsData } },
        include: { fields: { orderBy: { order: 'asc' } } },
      }),
    { uniqueMessage: 'A content type with this name already exists' }
  );

  setResponseStatus(event, 201);
  return created;
});
