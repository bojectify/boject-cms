import type { Builder } from './builder';
import type { ContentStatusEnumRef } from './types/contentStatus';
import { Prisma } from '#prisma';
import { prisma } from '../utils/prisma';

export function registerDynamicFilterInputs(
  builder: Builder,
  ContentStatusEnum: ContentStatusEnumRef
) {
  const DynStringFilter = builder.inputType('DynStringFilter', {
    fields: (t) => ({
      equals: t.string(),
      contains: t.string(),
    }),
  });

  const DynFloatFilter = builder.inputType('DynFloatFilter', {
    fields: (t) => ({
      equals: t.float(),
      gt: t.float(),
      gte: t.float(),
      lt: t.float(),
      lte: t.float(),
    }),
  });

  const DynBooleanFilter = builder.inputType('DynBooleanFilter', {
    fields: (t) => ({
      equals: t.boolean(),
    }),
  });

  const DynDateTimeFilter = builder.inputType('DynDateTimeFilter', {
    fields: (t) => ({
      equals: t.field({ type: 'DateTime' }),
      gt: t.field({ type: 'DateTime' }),
      gte: t.field({ type: 'DateTime' }),
      lt: t.field({ type: 'DateTime' }),
      lte: t.field({ type: 'DateTime' }),
    }),
  });

  const DynContentStatusFilter = builder.inputType('DynContentStatusFilter', {
    fields: (t) => ({
      equals: t.field({ type: ContentStatusEnum }),
    }),
  });

  return {
    DynStringFilter,
    DynFloatFilter,
    DynBooleanFilter,
    DynDateTimeFilter,
    DynContentStatusFilter,
  };
}

export type DynFilterRefs = ReturnType<typeof registerDynamicFilterInputs>;

const FIELD_TYPE_TO_FILTER_KEY: Record<string, keyof DynFilterRefs | null> = {
  ENTRY_TITLE: 'DynStringFilter',
  SLUG: 'DynStringFilter',
  TEXT: 'DynStringFilter',
  TEXTAREA: 'DynStringFilter',
  NUMBER: 'DynFloatFilter',
  BOOLEAN: 'DynBooleanFilter',
  DATETIME: 'DynDateTimeFilter',
  SELECT: 'DynStringFilter',
  RICHTEXT: null,
  RELATION: null,
  MULTIRELATION: null,
};

export function getFilterKeyForFieldType(
  fieldType: string
): keyof DynFilterRefs | null {
  return FIELD_TYPE_TO_FILTER_KEY[fieldType] ?? null;
}

interface JsonbCondition {
  sql: Prisma.Sql;
}

interface WhereArgs {
  status?: { equals?: string } | null;
  createdAt?: Record<string, unknown> | null;
  updatedAt?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface FieldDef {
  identifier: string;
  type: string;
}

export function buildDateConditions(
  identifier: string,
  filter: Record<string, unknown>,
  isJsonb: boolean,
  tablePrefix?: string
): JsonbCondition[] {
  const conditions: JsonbCondition[] = [];
  const ops = ['equals', 'gt', 'gte', 'lt', 'lte'] as const;
  const sqlOps: Record<string, string> = {
    equals: '=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  };

  const colPrefix = tablePrefix ? `${tablePrefix}.` : '';
  const dataRef = tablePrefix ? `${tablePrefix}."data"` : 'data';

  for (const op of ops) {
    if (filter[op] != null) {
      const value =
        filter[op] instanceof Date
          ? (filter[op] as Date).toISOString()
          : String(filter[op]);
      if (isJsonb) {
        conditions.push({
          sql: Prisma.sql`(${Prisma.raw(dataRef)}->>${Prisma.raw(`'${identifier}'`)})::timestamptz ${Prisma.raw(sqlOps[op]!)} ${value}::timestamptz`,
        });
      } else {
        conditions.push({
          sql: Prisma.sql`${Prisma.raw(`${colPrefix}"${identifier}"`)} ${Prisma.raw(sqlOps[op]!)} ${value}::timestamptz`,
        });
      }
    }
  }
  return conditions;
}

export function registerContentEntryWhere(
  builder: Builder,
  _ContentStatusEnum: ContentStatusEnumRef,
  dynFilters: DynFilterRefs
) {
  return builder.inputType('ContentEntryWhere', {
    fields: (t) => ({
      status: t.field({ type: dynFilters.DynContentStatusFilter }),
      contentType: t.field({ type: dynFilters.DynStringFilter }),
      createdAt: t.field({ type: dynFilters.DynDateTimeFilter }),
      updatedAt: t.field({ type: dynFilters.DynDateTimeFilter }),
    }),
  });
}

export async function queryDynamicEntries(
  contentTypeId: string,
  whereArgs: WhereArgs | null | undefined,
  fields: FieldDef[],
  limit: number,
  offset: number
): Promise<any[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`e."contentTypeId" = ${contentTypeId}`,
  ];

  if (whereArgs) {
    if (whereArgs.status?.equals) {
      conditions.push(
        Prisma.sql`v."status" = ${whereArgs.status.equals}`
      );
    }

    for (const sysField of ['createdAt', 'updatedAt'] as const) {
      if (whereArgs[sysField] && typeof whereArgs[sysField] === 'object') {
        const dateConditions = buildDateConditions(
          sysField,
          whereArgs[sysField] as Record<string, unknown>,
          false,
          'v'
        );
        conditions.push(...dateConditions.map((c) => c.sql));
      }
    }

    for (const field of fields) {
      const filterValue = whereArgs[field.identifier];
      if (!filterValue || typeof filterValue !== 'object') continue;
      const filter = filterValue as Record<string, unknown>;

      if (
        field.type === 'ENTRY_TITLE' ||
        field.type === 'SLUG' ||
        field.type === 'TEXT' ||
        field.type === 'TEXTAREA' ||
        field.type === 'SELECT'
      ) {
        if (filter.equals != null) {
          conditions.push(
            Prisma.sql`v."data"->>${Prisma.raw(`'${field.identifier}'`)} = ${String(filter.equals)}`
          );
        }
        if (filter.contains != null) {
          conditions.push(
            Prisma.sql`v."data"->>${Prisma.raw(`'${field.identifier}'`)} ILIKE ${'%' + String(filter.contains) + '%'}`
          );
        }
      } else if (field.type === 'NUMBER') {
        const numOps = ['equals', 'gt', 'gte', 'lt', 'lte'] as const;
        const sqlOps: Record<string, string> = {
          equals: '=',
          gt: '>',
          gte: '>=',
          lt: '<',
          lte: '<=',
        };
        for (const op of numOps) {
          if (filter[op] != null) {
            conditions.push(
              Prisma.sql`(v."data"->>${Prisma.raw(`'${field.identifier}'`)})::float ${Prisma.raw(sqlOps[op]!)} ${Number(filter[op])}`
            );
          }
        }
      } else if (field.type === 'BOOLEAN') {
        if (filter.equals != null) {
          conditions.push(
            Prisma.sql`(v."data"->>${Prisma.raw(`'${field.identifier}'`)})::boolean = ${Boolean(filter.equals)}`
          );
        }
      } else if (field.type === 'DATETIME') {
        const dateConditions = buildDateConditions(
          field.identifier,
          filter,
          true,
          'v'
        );
        conditions.push(...dateConditions.map((c) => c.sql));
      }
    }
  }

  const whereClause = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw`
    SELECT e."id", e."contentTypeId", v."data", e."slug",
           v."status", v."publishedAt", v."createdAt", v."updatedAt"
    FROM "ContentEntry" e
    JOIN "ContentEntryVersion" v ON v."entryId" = e."id"
    WHERE v."status" = 'PUBLISHED' AND ${whereClause}
    ORDER BY v."createdAt" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}
