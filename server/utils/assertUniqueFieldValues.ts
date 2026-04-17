import { Prisma } from '#prisma';
import type { FieldType } from '#prisma';
import { createError } from 'h3';
import { prisma } from './prisma';

interface FieldDef {
  identifier: string;
  name: string;
  type: FieldType;
  unique: boolean;
}

export async function assertUniqueFieldValues(
  data: Record<string, unknown>,
  fields: FieldDef[],
  contentTypeId: string,
  excludeEntryId?: string
): Promise<void> {
  for (const field of fields) {
    if (!field.unique) continue;
    if (field.type !== 'TEXT' && field.type !== 'NUMBER') continue;

    const value = data[field.identifier];
    if (value === null || value === undefined || value === '') continue;

    const rows = await queryConflicts(
      contentTypeId,
      field.identifier,
      field.type,
      value,
      excludeEntryId
    );

    if (rows.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: `${field.name} must be unique`,
        data: {
          error: 'UNIQUE_CONFLICT',
          field: field.identifier,
          message: `${field.name} must be unique`,
          value,
        },
      });
    }
  }
}

async function queryConflicts(
  contentTypeId: string,
  identifier: string,
  type: 'TEXT' | 'NUMBER',
  value: unknown,
  excludeEntryId: string | undefined
): Promise<Array<{ entryId: string }>> {
  // Raw SQL: pull any ContentEntryVersion (any status) for an entry in this
  // content type where the JSONB value at `identifier` matches. For NUMBER,
  // cast both sides to numeric; for TEXT, compare as text.
  const excludeClause = excludeEntryId
    ? Prisma.sql`AND ce."id" <> ${excludeEntryId}`
    : Prisma.empty;

  if (type === 'NUMBER') {
    return prisma.$queryRaw<Array<{ entryId: string }>>`
      SELECT ce."id" AS "entryId"
      FROM "ContentEntry" ce
      JOIN "ContentEntryVersion" cev ON cev."entryId" = ce."id"
      WHERE ce."contentTypeId" = ${contentTypeId}
        ${excludeClause}
        AND (cev."data" ->> ${identifier})::numeric = ${Number(value)}::numeric
      LIMIT 1
    `;
  }

  return prisma.$queryRaw<Array<{ entryId: string }>>`
    SELECT ce."id" AS "entryId"
    FROM "ContentEntry" ce
    JOIN "ContentEntryVersion" cev ON cev."entryId" = ce."id"
    WHERE ce."contentTypeId" = ${contentTypeId}
      ${excludeClause}
      AND cev."data" ->> ${identifier} = ${String(value)}
    LIMIT 1
  `;
}
