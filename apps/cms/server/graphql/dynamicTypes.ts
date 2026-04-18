import type { Builder } from './builder';
import type { ContentStatusEnumRef } from './types/contentStatus';
import { resolveOffsetConnection } from '@pothos/plugin-relay';
import { prisma } from '../utils/prisma';
import {
  registerDynamicFilterInputs,
  getFilterKeyForFieldType,
  queryDynamicEntries,
  buildDateConditions,
  registerContentEntryWhere,
} from './jsonbFilters';
import { Prisma } from '#prisma';

interface ContentTypeWithFields {
  id: string;
  name: string;
  identifier: string;
  fields: Array<{
    id: string;
    identifier: string;
    name: string;
    type: string;
    required: boolean;
    options: unknown;
    order: number;
  }>;
}

// Shape of a ContentEntry row as returned by Prisma. Kept loose so that
// interface/object refs can be strongly-typed without pulling Prisma generics.
interface ContentEntryShape {
  id: string;
  contentTypeId: string;
  data: unknown;
  slug: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED';
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Build a ContentEntryShape from a ContentEntry envelope + its published
 * ContentEntryVersion. The envelope owns id/contentTypeId/slug while the
 * version owns data/status/publishedAt/timestamps.
 */
function flattenToShape(
  entry: {
    id: string;
    contentTypeId: string;
    slug: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  version: {
    data: unknown;
    status: string;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }
): ContentEntryShape {
  return {
    id: entry.id,
    contentTypeId: entry.contentTypeId,
    data: version.data,
    slug: entry.slug,
    status: version.status as ContentEntryShape['status'],
    publishedAt: version.publishedAt,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

type ScalarTypeName = 'String' | 'Float' | 'Boolean' | 'DateTime' | 'JSON';

const FIELD_TYPE_TO_SCALAR: Record<string, ScalarTypeName | undefined> = {
  ENTRY_TITLE: 'String',
  SLUG: 'String',
  TEXT: 'String',
  TEXTAREA: 'String',
  NUMBER: 'Float',
  BOOLEAN: 'Boolean',
  DATETIME: 'DateTime',
  SELECT: 'String',
  RICHTEXT: 'JSON',
};

function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

export function registerDynamicTypes(
  builder: Builder,
  contentTypes: ContentTypeWithFields[],
  ContentStatusEnum: ContentStatusEnumRef
) {
  const typeIdToIdentifier = new Map<string, string>();
  for (const ct of contentTypes) {
    typeIdToIdentifier.set(ct.id, ct.identifier);
  }

  const ContentEntryInterface = builder
    .interfaceRef<ContentEntryShape>('ContentEntry')
    .implement({
      fields: (t) => ({
        id: t.id({ resolve: (entry) => entry.id }),
        contentType: t.string({
          resolve: (entry) =>
            typeIdToIdentifier.get(entry.contentTypeId) ?? 'ContentEntry',
        }),
        status: t.field({
          type: ContentStatusEnum,
          resolve: (entry) => entry.status,
        }),
        publishedAt: t.field({
          type: 'DateTime',
          nullable: true,
          resolve: (entry) => entry.publishedAt,
        }),
        createdAt: t.field({
          type: 'DateTime',
          resolve: (entry) => entry.createdAt,
        }),
        updatedAt: t.field({
          type: 'DateTime',
          resolve: (entry) => entry.updatedAt,
        }),
      }),
      resolveType: (entry) =>
        typeIdToIdentifier.get(entry.contentTypeId) ?? 'ContentEntry',
    });

  const dynFilters = registerDynamicFilterInputs(builder, ContentStatusEnum);

  const typeRefs = new Map<string, ReturnType<Builder['objectRef']>>();

  for (const ct of contentTypes) {
    const scalarFields = ct.fields.filter(
      (f) => FIELD_TYPE_TO_SCALAR[f.type] !== undefined
    );

    const filterableFields = ct.fields.filter(
      (f) => getFilterKeyForFieldType(f.type) !== null
    );

    const WhereInput = builder.inputType(`${ct.identifier}Where`, {
      fields: (t) => {
        const whereFields: Record<string, unknown> = {
          status: t.field({ type: dynFilters.DynContentStatusFilter }),
          createdAt: t.field({ type: dynFilters.DynDateTimeFilter }),
          updatedAt: t.field({ type: dynFilters.DynDateTimeFilter }),
        };
        for (const field of filterableFields) {
          const filterKey = getFilterKeyForFieldType(field.type);
          if (filterKey) {
            whereFields[field.identifier] = t.field({
              type: dynFilters[filterKey],
            });
          }
        }
        return whereFields as never;
      },
    });

    const implRef = builder.objectRef<ContentEntryShape>(ct.identifier);
    const ref = implRef.implement({
      interfaces: [ContentEntryInterface],
      fields: (t) => {
        const fields: Record<string, unknown> = {
          id: t.id({ resolve: (entry) => entry.id }),
          contentType: t.string({
            resolve: () => ct.identifier,
          }),
          status: t.field({
            type: ContentStatusEnum,
            resolve: (entry) => entry.status,
          }),
          publishedAt: t.field({
            type: 'DateTime',
            nullable: true,
            resolve: (entry) => entry.publishedAt,
          }),
          createdAt: t.field({
            type: 'DateTime',
            resolve: (entry) => entry.createdAt,
          }),
          updatedAt: t.field({
            type: 'DateTime',
            resolve: (entry) => entry.updatedAt,
          }),
        };

        for (const field of scalarFields) {
          const scalarType = FIELD_TYPE_TO_SCALAR[field.type]!;
          const isRequired = field.required || field.type === 'ENTRY_TITLE';

          const resolver = (entry: ContentEntryShape) => {
            const data =
              typeof entry.data === 'string'
                ? (JSON.parse(entry.data) as Record<string, unknown>)
                : (entry.data as Record<string, unknown> | null);
            return data?.[field.identifier] ?? null;
          };

          fields[field.identifier] = t.field({
            type: scalarType,
            nullable: !isRequired,
            // Pothos infers resolve return type from `type`; since `scalarType`
            // is a runtime-chosen union member, we cast to satisfy the mapped
            // field-builder signature.
            resolve: resolver as never,
          });
        }

        // RELATION fields (single polymorphic reference)
        const relationFields = ct.fields.filter((f) => f.type === 'RELATION');
        for (const field of relationFields) {
          const opts = field.options as {
            targetContentTypeIds?: string[];
          } | null;
          const targetIds = opts?.targetContentTypeIds ?? [];

          const resolveRef = async (entry: ContentEntryShape) => {
            const data =
              typeof entry.data === 'string'
                ? (JSON.parse(entry.data) as Record<string, unknown>)
                : (entry.data as Record<string, unknown> | null);
            const ref = data?.[field.identifier] as {
              entryId?: string;
            } | null;
            if (!ref?.entryId) return null;
            const related = await prisma.contentEntry.findUnique({
              where: { id: ref.entryId },
              include: { versions: { where: { status: 'PUBLISHED' } } },
            });
            if (!related || related.versions.length === 0) return null;
            return flattenToShape(related, related.versions[0]!);
          };

          if (targetIds.length === 1) {
            const targetRef = typeRefs.get(targetIds[0]!);
            if (!targetRef) continue;
            fields[field.identifier] = t.field({
              type: targetRef,
              nullable: !field.required,
              resolve: resolveRef as never,
            });
          } else if (targetIds.length > 1) {
            const targetRefs = targetIds
              .map((id) => typeRefs.get(id))
              .filter((r): r is NonNullable<typeof r> => Boolean(r));
            if (targetRefs.length === 0) continue;
            const pascalField =
              field.identifier.charAt(0).toUpperCase() +
              field.identifier.slice(1);
            const unionRef = builder.unionType(
              `${ct.identifier}${pascalField}Union`,
              {
                types: targetRefs as never,
                resolveType: (value: unknown) => {
                  const v = value as { contentTypeId?: string } | null;
                  return (
                    (v?.contentTypeId &&
                      typeIdToIdentifier.get(v.contentTypeId)) ||
                    ct.identifier
                  );
                },
              }
            );
            fields[field.identifier] = t.field({
              type: unionRef,
              nullable: !field.required,
              resolve: resolveRef as never,
            });
          }
        }

        // MULTIRELATION fields (ordered list of polymorphic references)
        const multiRelationFields = ct.fields.filter(
          (f) => f.type === 'MULTIRELATION'
        );
        for (const field of multiRelationFields) {
          const opts = field.options as {
            targetContentTypeIds?: string[];
          } | null;
          const targetIds = opts?.targetContentTypeIds ?? [];

          let nodeType: ReturnType<Builder['objectRef']> | undefined;
          if (targetIds.length === 1) {
            nodeType = typeRefs.get(targetIds[0]!);
          } else if (targetIds.length > 1) {
            const targetRefs = targetIds
              .map((id) => typeRefs.get(id))
              .filter((r): r is NonNullable<typeof r> => Boolean(r));
            if (targetRefs.length === 0) continue;
            const pascalField =
              field.identifier.charAt(0).toUpperCase() +
              field.identifier.slice(1);
            nodeType = builder.unionType(
              `${ct.identifier}${pascalField}Union`,
              {
                types: targetRefs as never,
                resolveType: (value: unknown) => {
                  const v = value as { contentTypeId?: string } | null;
                  return (
                    (v?.contentTypeId &&
                      typeIdToIdentifier.get(v.contentTypeId)) ||
                    ct.identifier
                  );
                },
              }
            ) as never;
          }
          if (!nodeType) continue;

          fields[field.identifier] = t.connection({
            type: nodeType,
            resolve: (entry: ContentEntryShape, args: unknown) =>
              resolveOffsetConnection(
                {
                  args: args as Parameters<
                    typeof resolveOffsetConnection
                  >[0]['args'],
                },
                async ({ limit, offset }) => {
                  const data =
                    typeof entry.data === 'string'
                      ? (JSON.parse(entry.data) as Record<string, unknown>)
                      : (entry.data as Record<string, unknown> | null);
                  const refs = data?.[field.identifier];
                  if (!Array.isArray(refs) || refs.length === 0) return [];
                  const entryIds = refs
                    .slice(offset, offset + limit)
                    .map((r: { entryId?: string }) => r.entryId)
                    .filter((id): id is string => Boolean(id));
                  if (entryIds.length === 0) return [];
                  const entries = await prisma.contentEntry.findMany({
                    where: { id: { in: entryIds } },
                    include: {
                      versions: { where: { status: 'PUBLISHED' } },
                    },
                  });
                  const byId = new Map(
                    entries
                      .filter((e) => e.versions.length > 0)
                      .map((e) => [e.id, flattenToShape(e, e.versions[0]!)])
                  );
                  return entryIds
                    .map((id) => byId.get(id))
                    .filter((e): e is NonNullable<typeof e> => Boolean(e));
                }
              ),
          }) as never;
        }

        return fields as never;
      },
    });
    typeRefs.set(ct.id, implRef);

    const camelName = toCamelCase(ct.identifier);

    builder.queryField(`${camelName}List`, (t) =>
      t.connection({
        type: ref,
        args: { where: t.arg({ type: WhereInput }) },
        resolve: (_root, args) =>
          resolveOffsetConnection({ args }, async ({ limit, offset }) => {
            return queryDynamicEntries(
              ct.id,
              args.where as never,
              ct.fields,
              limit,
              offset
            );
          }),
      })
    );

    builder.queryField(camelName, (t) =>
      t.field({
        type: ref,
        nullable: true,
        args: { id: t.arg.id({ required: true }) },
        resolve: async (_root, args) => {
          const entry = await prisma.contentEntry.findFirst({
            where: { id: String(args.id), contentTypeId: ct.id },
            include: { versions: { where: { status: 'PUBLISHED' } } },
          });
          if (!entry || entry.versions.length === 0) return null;
          return flattenToShape(entry, entry.versions[0]!);
        },
      })
    );

    const hasSlug = ct.fields.some((f) => f.type === 'SLUG');
    if (hasSlug) {
      builder.queryField(`${camelName}BySlug`, (t) =>
        t.field({
          type: ref,
          nullable: true,
          args: { slug: t.arg.string({ required: true }) },
          resolve: async (_root, args) => {
            const entry = await prisma.contentEntry.findFirst({
              where: { contentTypeId: ct.id, slug: args.slug },
              include: { versions: { where: { status: 'PUBLISHED' } } },
            });
            if (!entry || entry.versions.length === 0) return null;
            return flattenToShape(entry, entry.versions[0]!);
          },
        })
      );
    }
  }

  // Cross-type root query: contentEntryList
  const ContentEntryWhere = registerContentEntryWhere(
    builder,
    ContentStatusEnum,
    dynFilters
  );

  builder.queryField('contentEntryList', (t) =>
    t.connection({
      type: ContentEntryInterface as never,
      args: { where: t.arg({ type: ContentEntryWhere }) },
      resolve: (_root, args) =>
        resolveOffsetConnection({ args }, async ({ limit, offset }) => {
          const conditions: Prisma.Sql[] = [];
          const whereArgs = args.where as {
            status?: { equals?: string } | null;
            contentType?: { equals?: string; contains?: string } | null;
            createdAt?: Record<string, unknown> | null;
            updatedAt?: Record<string, unknown> | null;
          } | null;

          if (whereArgs?.status?.equals) {
            conditions.push(
              Prisma.sql`v."status" = ${whereArgs.status.equals}`
            );
          }
          if (whereArgs?.contentType?.equals) {
            const ct = contentTypes.find(
              (c) => c.identifier === whereArgs.contentType!.equals
            );
            if (ct) {
              conditions.push(Prisma.sql`e."contentTypeId" = ${ct.id}`);
            } else {
              return [];
            }
          }
          if (whereArgs?.contentType?.contains) {
            const matchingIds = contentTypes
              .filter((c) =>
                c.identifier
                  .toLowerCase()
                  .includes(
                    String(whereArgs.contentType!.contains).toLowerCase()
                  )
              )
              .map((c) => c.id);
            if (matchingIds.length === 0) return [];
            conditions.push(
              Prisma.sql`e."contentTypeId" IN (${Prisma.join(matchingIds)})`
            );
          }

          for (const sysField of ['createdAt', 'updatedAt'] as const) {
            if (whereArgs?.[sysField]) {
              const dateConditions = buildDateConditions(
                sysField,
                whereArgs[sysField] as Record<string, unknown>,
                false,
                'v'
              );
              conditions.push(...dateConditions.map((c) => c.sql));
            }
          }

          const whereClause =
            conditions.length > 0
              ? Prisma.join(conditions, ' AND ')
              : Prisma.sql`1=1`;

          return (await prisma.$queryRaw`
            SELECT e."id", e."contentTypeId", v."data", e."slug",
                   v."status", v."publishedAt", v."createdAt", v."updatedAt"
            FROM "ContentEntry" e
            JOIN "ContentEntryVersion" v ON v."entryId" = e."id"
            WHERE v."status" = 'PUBLISHED' AND ${whereClause}
            ORDER BY v."createdAt" DESC
            LIMIT ${limit} OFFSET ${offset}
          `) as unknown[];
        }) as never,
    })
  );

  return { typeRefs, ContentEntryInterface, typeIdToIdentifier };
}
