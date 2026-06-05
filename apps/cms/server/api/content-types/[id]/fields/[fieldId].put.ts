import type { FieldType, Prisma } from '#prisma';
import { assertUuid, assertStringLength } from '../../../../utils/validation';
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
  enforceMutationRateLimit(event, 'content-type-fields.put');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const fieldId = assertUuid(getRouterParam(event, 'fieldId'), 'fieldId');
  const body = await readBody<Record<string, unknown>>(event);

  // Verify field exists and belongs to this content type
  const field = await prisma.contentTypeField.findUnique({
    where: { id: fieldId },
    include: { contentType: { select: { id: true, identifier: true } } },
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
    if (
      field.type === FIELD_TYPES.RICHTEXT &&
      body.options &&
      typeof body.options === 'object'
    ) {
      try {
        parseFieldOptions({
          type: FIELD_TYPES.RICHTEXT,
          options: body.options,
        });
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
    }
    if (
      field.type === FIELD_TYPES.RELATION ||
      field.type === FIELD_TYPES.MULTIRELATION
    ) {
      let opts;
      try {
        opts = parseFieldOptions({ type: field.type, options: body.options });
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
    data.options = body.options ?? undefined;
  }
  if ('unique' in body) {
    if (typeof body.unique !== 'boolean') {
      throw createError({
        statusCode: 400,
        statusMessage: 'unique must be a boolean',
      });
    }
    if (
      (field.type === FIELD_TYPES.ENTRY_TITLE ||
        field.type === FIELD_TYPES.SLUG) &&
      body.unique === false
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: `unique cannot be disabled on ${field.type} fields`,
      });
    }
    // Force implicit-unique types back to true even if body says true explicitly.
    // Throw for user-configurable types requesting unique on a non-TEXT/NUMBER field.
    const nextUnique = resolveUniqueFlag(field.type, body.unique);

    // When flipping false -> true on a TEXT/NUMBER field, block if duplicates exist.
    if (
      nextUnique &&
      !field.unique &&
      (field.type === FIELD_TYPES.TEXT || field.type === FIELD_TYPES.NUMBER)
    ) {
      const conflicts = await findDuplicateGroups(
        contentTypeId,
        field.identifier,
        field.type
      );
      if (conflicts.length > 0) {
        throw createError({
          statusCode: 409,
          statusMessage:
            'Cannot mark field as unique — existing entries have duplicate values',
          data: {
            error: 'UNIQUE_CONFLICT',
            message:
              'Cannot mark field as unique — existing entries have duplicate values',
            conflicts,
          },
        });
      }
    }

    data.unique = nextUnique;
  }

  // If updating type, block if entries exist
  if ('type' in body) {
    if (!isFieldTypeName(body.type)) {
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
      prisma.$transaction(async (tx) => {
        const f = await tx.contentTypeField.update({
          where: { id: fieldId },
          data,
        });
        await enqueueContentTypeSchemaChanged(tx, {
          contentType: field.contentType,
        });
        return f;
      }),
    {
      uniqueMessage:
        'A field with this name already exists on this content type',
    }
  );

  invalidateSchema();

  return updated;
});

/**
 * Find entries whose latest version holds a duplicated value for the given field.
 *
 * This uses "latest version per entry" (DISTINCT ON + ORDER BY updatedAt DESC),
 * not "all versions" (which is what `assertUniqueFieldValues` does at save time).
 * Rationale: the toggle check should only block the user when enabling unique
 * would prevent an entry from re-saving its current editor state. Archived or
 * older-draft collisions aren't user-visible and don't belong in the confirm
 * dialog. Save-time collisions still use the all-versions check.
 */
async function findDuplicateGroups(
  contentTypeId: string,
  identifier: string,
  type: typeof FIELD_TYPES.TEXT | typeof FIELD_TYPES.NUMBER
): Promise<Array<{ value: unknown; entryIds: string[] }>> {
  // For each entry, pick the most-recent version's value at `identifier`. Group
  // entries by that value and return groups with COUNT > 1. Null/empty excluded.
  if (type === FIELD_TYPES.NUMBER) {
    // Cast to double precision (not numeric) so @prisma/adapter-pg returns a JS
    // number rather than a string. NUMBER fields in this CMS hold ordinary
    // user-facing values (issue numbers, prices, counts) where double-precision
    // floats are sufficient.
    const rows = await prisma.$queryRaw<
      Array<{ value: number; entryIds: string[] }>
    >`
      SELECT v.value, array_agg(v."entryId") AS "entryIds"
      FROM (
        SELECT DISTINCT ON (cev."entryId")
          cev."entryId",
          (cev."data" ->> ${identifier})::double precision AS value
        FROM "ContentEntryVersion" cev
        JOIN "ContentEntry" ce ON ce."id" = cev."entryId"
        WHERE ce."contentTypeId" = ${contentTypeId}
          AND cev."data" ? ${identifier}
          AND cev."data" ->> ${identifier} <> ''
        ORDER BY cev."entryId", cev."updatedAt" DESC
      ) v
      GROUP BY v.value
      HAVING COUNT(*) > 1
    `;
    return rows.map((r) => ({ value: r.value, entryIds: r.entryIds }));
  }

  const rows = await prisma.$queryRaw<
    Array<{ value: string; entryIds: string[] }>
  >`
    SELECT v.value, array_agg(v."entryId") AS "entryIds"
    FROM (
      SELECT DISTINCT ON (cev."entryId")
        cev."entryId",
        cev."data" ->> ${identifier} AS value
      FROM "ContentEntryVersion" cev
      JOIN "ContentEntry" ce ON ce."id" = cev."entryId"
      WHERE ce."contentTypeId" = ${contentTypeId}
        AND cev."data" ? ${identifier}
        AND cev."data" ->> ${identifier} <> ''
      ORDER BY cev."entryId", cev."updatedAt" DESC
    ) v
    GROUP BY v.value
    HAVING COUNT(*) > 1
  `;
  return rows.map((r) => ({ value: r.value, entryIds: r.entryIds }));
}
