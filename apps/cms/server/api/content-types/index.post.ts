import type { FieldType } from '#prisma';
import {
  assertStringLength,
  assertIdentifier,
  assertFieldIdentifier,
  toPascalCase,
} from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { invalidateSchema } from '../../graphql/schema';
import { resolveUniqueFlag } from '../../utils/validateFieldUnique';
import { assertSchemaEditable } from '../../utils/schemaReadOnly';
import { parseFieldOptions } from '../../../utils/fieldOptions';

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
  'RELATION',
  'MULTIRELATION',
  'IMAGE',
]);

const NAME_MAX = 200;

export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-types.post');
  const body = await readBody<Record<string, unknown>>(event);

  const name = assertStringLength(body.name, 'name', NAME_MAX);
  const identifier =
    typeof body.identifier === 'string'
      ? assertIdentifier(body.identifier, 'identifier')
      : assertIdentifier(toPascalCase(name), 'identifier');
  const description =
    typeof body.description === 'string' ? body.description : null;

  if (!Array.isArray(body.fields) || body.fields.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fields array is required and must not be empty',
    });
  }

  const fieldIdentifiers = new Set<string>();
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

    const fieldIdentifier = assertFieldIdentifier(
      f.identifier,
      `fields[${idx}].identifier`
    );
    if (fieldIdentifiers.has(fieldIdentifier)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Duplicate field identifier: ${fieldIdentifier}`,
      });
    }
    fieldIdentifiers.add(fieldIdentifier);

    const fieldName = assertStringLength(f.name, `fields[${idx}].name`, 200);

    if (typeof f.type !== 'string' || !VALID_FIELD_TYPES.has(f.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: `fields[${idx}].type must be a valid FieldType`,
      });
    }
    const type = f.type as FieldType;

    if (type === 'RELATION' || type === 'MULTIRELATION') {
      let opts;
      try {
        opts = parseFieldOptions({ type, options: f.options });
      } catch {
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid UUID in fields[${idx}].options.targetContentTypeIds`,
        });
      }
      const ids =
        opts.type === 'RELATION' || opts.type === 'MULTIRELATION'
          ? opts.targetContentTypeIds
          : [];
      if (ids.length === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: `fields[${idx}].options.targetContentTypeIds is required for relation fields`,
        });
      }
    }

    if (type === 'RICHTEXT' && f.options && typeof f.options === 'object') {
      try {
        parseFieldOptions({ type, options: f.options });
      } catch (e) {
        const issues =
          (
            e as {
              issues?: Array<{ path: (string | number)[]; code?: string }>;
            }
          ).issues ?? [];
        const firstPath = issues[0]?.path[0];
        const key =
          firstPath === 'targetContentTypeIds' ||
          firstPath === 'linkTargetContentTypeIds'
            ? firstPath
            : 'targetContentTypeIds';
        const code = issues[0]?.code;
        throw createError({
          statusCode: 400,
          statusMessage:
            code === 'invalid_type'
              ? `fields[${idx}].options.${key} must be an array`
              : `Invalid UUID in fields[${idx}].options.${key}`,
        });
      }
    }

    if (type === 'ENTRY_TITLE') entryTitleCount++;
    if (type === 'SLUG') slugCount++;

    const uniqueFlag = resolveUniqueFlag(
      type,
      typeof f.unique === 'boolean' ? f.unique : undefined
    );

    return {
      identifier: fieldIdentifier,
      name: fieldName,
      type,
      required: typeof f.required === 'boolean' ? f.required : false,
      unique: uniqueFlag,
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
        data: { name, identifier, description, fields: { create: fieldsData } },
        include: { fields: { orderBy: { order: 'asc' } } },
      }),
    {
      uniqueMessage:
        'A content type with this name or identifier already exists',
    }
  );

  invalidateSchema();

  setResponseStatus(event, 201);
  return created;
});
