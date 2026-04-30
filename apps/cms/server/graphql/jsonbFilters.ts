import type { Builder } from './builder';
import type { ContentEntryShape } from './dynamicTypes';
import type { ContentStatusEnumRef } from './types/contentStatus';
import { Prisma } from '#prisma';
import { createError } from 'h3';
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

  const DynRelationFilter = builder.inputType('DynRelationFilter', {
    fields: (t) => ({
      equals: t.id(),
      in: t.idList(),
      isNull: t.boolean(),
    }),
  });

  const DynMultirelationFilter = builder.inputType('DynMultirelationFilter', {
    fields: (t) => ({
      contains: t.id(),
      containsAny: t.idList(),
      containsAll: t.idList(),
      isEmpty: t.boolean(),
    }),
  });

  return {
    DynStringFilter,
    DynFloatFilter,
    DynBooleanFilter,
    DynDateTimeFilter,
    DynContentStatusFilter,
    DynRelationFilter,
    DynMultirelationFilter,
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
  RELATION: 'DynRelationFilter',
  MULTIRELATION: 'DynMultirelationFilter',
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
  options?: unknown;
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

export const MAX_RELATION_FILTER_DEPTH = 5;

export interface ContentTypeForFilter {
  id: string;
  identifier: string;
  fields: FieldDef[];
}

export function buildEntryConditions(
  whereArgs: WhereArgs | null | undefined,
  contentType: ContentTypeForFilter,
  // reserved for Task 3-5 recursive relation target lookups
  contentTypes: ContentTypeForFilter[],
  alias: { entry: string; version: string },
  depth: number
): Prisma.Sql[] {
  if (depth > MAX_RELATION_FILTER_DEPTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `relation filter nesting exceeds maximum depth (${MAX_RELATION_FILTER_DEPTH})`,
    });
  }

  const conditions: Prisma.Sql[] = [];
  if (!whereArgs) return conditions;

  const v = Prisma.raw(`"${alias.version}"`);

  if (whereArgs.status?.equals) {
    conditions.push(Prisma.sql`${v}."status" = ${whereArgs.status.equals}`);
  }

  for (const sysField of ['createdAt', 'updatedAt'] as const) {
    if (whereArgs[sysField] && typeof whereArgs[sysField] === 'object') {
      const dateConditions = buildDateConditions(
        sysField,
        whereArgs[sysField] as Record<string, unknown>,
        false,
        alias.version
      );
      conditions.push(...dateConditions.map((c) => c.sql));
    }
  }

  for (const field of contentType.fields) {
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
          Prisma.sql`${v}."data"->>${Prisma.raw(`'${field.identifier}'`)} = ${String(filter.equals)}`
        );
      }
      if (filter.contains != null) {
        conditions.push(
          Prisma.sql`${v}."data"->>${Prisma.raw(`'${field.identifier}'`)} ILIKE ${'%' + String(filter.contains) + '%'}`
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
            Prisma.sql`(${v}."data"->>${Prisma.raw(`'${field.identifier}'`)})::float ${Prisma.raw(sqlOps[op]!)} ${Number(filter[op])}`
          );
        }
      }
    } else if (field.type === 'BOOLEAN') {
      if (filter.equals != null) {
        conditions.push(
          Prisma.sql`(${v}."data"->>${Prisma.raw(`'${field.identifier}'`)})::boolean = ${Boolean(filter.equals)}`
        );
      }
    } else if (field.type === 'DATETIME') {
      const dateConditions = buildDateConditions(
        field.identifier,
        filter,
        true,
        alias.version
      );
      conditions.push(...dateConditions.map((c) => c.sql));
    } else if (field.type === 'RELATION') {
      const ident = Prisma.raw(`'${field.identifier}'`);
      if (typeof filter.equals === 'string' && filter.equals.length > 0) {
        conditions.push(
          Prisma.sql`${v}."data"->${ident}->>'entryId' = ${filter.equals}`
        );
      }
      if (Array.isArray(filter.in) && filter.in.length > 0) {
        const ids = (filter.in as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.length > 0
        );
        if (ids.length === 0) {
          conditions.push(Prisma.sql`FALSE`);
        } else {
          conditions.push(
            Prisma.sql`${v}."data"->${ident}->>'entryId' = ANY(${ids})`
          );
        }
      }
      if (filter.isNull === true) {
        conditions.push(
          Prisma.sql`(${v}."data"->${ident} IS NULL OR ${v}."data"->${ident} = 'null'::jsonb OR ${v}."data"->${ident}->>'entryId' IS NULL)`
        );
      } else if (filter.isNull === false) {
        conditions.push(
          Prisma.sql`(${v}."data"->${ident} IS NOT NULL AND ${v}."data"->${ident} <> 'null'::jsonb AND ${v}."data"->${ident}->>'entryId' IS NOT NULL)`
        );
      }
      if (filter.is && typeof filter.is === 'object') {
        const opts = field.options as {
          targetContentTypeIds?: string[];
        } | null;
        const targetIds = opts?.targetContentTypeIds ?? [];
        if (targetIds.length === 1) {
          const targetType = contentTypes.find((c) => c.id === targetIds[0]);
          if (targetType) {
            const childAlias = {
              entry: `e${depth + 1}`,
              version: `v${depth + 1}`,
            };
            const childConditions = buildEntryConditions(
              filter.is as WhereArgs,
              targetType,
              contentTypes,
              childAlias,
              depth + 1
            );
            const childWhere =
              childConditions.length > 0
                ? Prisma.join(childConditions, ' AND ')
                : Prisma.sql`TRUE`;
            const cAlias = Prisma.raw(`"${childAlias.entry}"`);
            const cVAlias = Prisma.raw(`"${childAlias.version}"`);
            conditions.push(
              Prisma.sql`EXISTS (
                SELECT 1 FROM "ContentEntry" ${cAlias}
                JOIN "ContentEntryVersion" ${cVAlias} ON ${cVAlias}."entryId" = ${cAlias}."id"
                WHERE ${cAlias}."id"::text = (${v}."data"->${ident}->>'entryId')
                  AND ${cAlias}."contentTypeId" = ${targetType.id}
                  AND ${cVAlias}."status" = 'PUBLISHED'
                  AND ${childWhere}
              )`
            );
          }
        }
      }
    } else if (field.type === 'MULTIRELATION') {
      const ident = Prisma.raw(`'${field.identifier}'`);
      if (typeof filter.contains === 'string' && filter.contains.length > 0) {
        conditions.push(
          Prisma.sql`${v}."data"->${ident} @> jsonb_build_array(jsonb_build_object('entryId', ${filter.contains}::text))`
        );
      }
      if (Array.isArray(filter.containsAny) && filter.containsAny.length > 0) {
        const ids = (filter.containsAny as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.length > 0
        );
        if (ids.length === 0) {
          conditions.push(Prisma.sql`FALSE`);
        } else {
          conditions.push(
            Prisma.sql`(jsonb_typeof(${v}."data"->${ident}) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(${v}."data"->${ident}) AS ref WHERE ref->>'entryId' = ANY(${ids})))`
          );
        }
      }
      if (Array.isArray(filter.containsAll) && filter.containsAll.length > 0) {
        const ids = (filter.containsAll as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.length > 0
        );
        if (ids.length === 0) {
          conditions.push(Prisma.sql`FALSE`);
        } else {
          for (const id of ids) {
            conditions.push(
              Prisma.sql`${v}."data"->${ident} @> jsonb_build_array(jsonb_build_object('entryId', ${id}::text))`
            );
          }
        }
      }
      // CASE WHEN guards jsonb_array_length against scalar-null data:
      // Postgres does not guarantee left-to-right AND short-circuit in WHERE,
      // so a bare `typeof = 'array' AND length(...)` can crash on JSONB null.
      if (filter.isEmpty === true) {
        conditions.push(
          Prisma.sql`(${v}."data"->${ident} IS NULL OR ${v}."data"->${ident} = 'null'::jsonb OR (CASE WHEN jsonb_typeof(${v}."data"->${ident}) = 'array' THEN jsonb_array_length(${v}."data"->${ident}) = 0 ELSE FALSE END))`
        );
      } else if (filter.isEmpty === false) {
        conditions.push(
          Prisma.sql`(CASE WHEN jsonb_typeof(${v}."data"->${ident}) = 'array' THEN jsonb_array_length(${v}."data"->${ident}) > 0 ELSE FALSE END)`
        );
      }
    }
  }

  return conditions;
}

export async function queryDynamicEntries(
  contentTypeId: string,
  whereArgs: WhereArgs | null | undefined,
  contentTypes: ContentTypeForFilter[],
  limit: number,
  offset: number
): Promise<ContentEntryShape[]> {
  const contentType = contentTypes.find((ct) => ct.id === contentTypeId);
  if (!contentType) {
    throw createError({
      statusCode: 500,
      statusMessage: `unknown contentType ${contentTypeId} in filter context`,
    });
  }

  const conditions: Prisma.Sql[] = [
    Prisma.sql`e."contentTypeId" = ${contentTypeId}`,
    ...buildEntryConditions(
      whereArgs,
      contentType,
      contentTypes,
      { entry: 'e', version: 'v' },
      0
    ),
  ];

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
