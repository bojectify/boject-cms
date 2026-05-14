import type { Builder } from './builder';
import type { ContentStatusEnumRef } from './types/contentStatus';
import { resolveOffsetConnection } from '@pothos/plugin-relay';
import { prisma } from '../utils/prisma';
import { parseFieldOptions } from '../../utils/fieldOptions';
import { collectRichtextReferences } from '../utils/collectRichtextReferences';
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
export interface ContentEntryShape {
  id: string;
  contentTypeId: string;
  data: unknown;
  slug: string | null;
  entryKey: string;
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
    entryKey: string;
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
    entryKey: entry.entryKey,
    status: version.status as ContentEntryShape['status'],
    publishedAt: version.publishedAt,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

/**
 * Read an entry's `data` JSONB as a plain object.
 *
 * Resolvers reach `data` via two paths with different shapes:
 * - `prisma.contentEntry.findFirst/Unique/Many` returns the JSONB column
 *   already parsed (typed as Prisma.JsonValue, but at runtime an object).
 * - `prisma.$queryRaw` returns the JSONB column as a JSON string.
 *
 * This helper hides that fork so resolvers can just call
 * `parseEntryData(entry)?.[identifier]`.
 */
function parseEntryData(
  entry: ContentEntryShape
): Record<string, unknown> | null {
  return typeof entry.data === 'string'
    ? (JSON.parse(entry.data) as Record<string, unknown>)
    : (entry.data as Record<string, unknown> | null);
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
        entryKey: t.string({ resolve: (entry) => entry.entryKey }),
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

  interface ImageFileShape {
    storageKey: string;
    mimeType: string;
    width: number;
    height: number;
    fileSize: number;
    originalName: string | null;
    focalPointX: number;
    focalPointY: number;
  }

  // Shared object type for IMAGE field values. The wrapping content type
  // (e.g. the starter `Image`) carries metadata (alt, credit, caption)
  // around an `ImageFile`-typed field. Naming kept distinct from any
  // user-defined `Image` content type.
  const ImageFileRef = builder
    .objectRef<ImageFileShape>('ImageFile')
    .implement({
      fields: (t) => ({
        storageKey: t.exposeString('storageKey'),
        mimeType: t.exposeString('mimeType'),
        width: t.exposeInt('width'),
        height: t.exposeInt('height'),
        fileSize: t.exposeInt('fileSize'),
        originalName: t.exposeString('originalName', { nullable: true }),
        focalPointX: t.exposeFloat('focalPointX'),
        focalPointY: t.exposeFloat('focalPointY'),
        url: t.string({
          resolve: (img) => `/api/files/${img.storageKey}/transform`,
        }),
      }),
    });

  function readImageField(
    entry: ContentEntryShape,
    identifier: string
  ): ImageFileShape | null {
    const data = parseEntryData(entry);
    const raw = data?.[identifier];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.storageKey !== 'string' || !obj.storageKey) return null;
    const mimeType = typeof obj.mimeType === 'string' ? obj.mimeType : '';
    const width = typeof obj.width === 'number' ? obj.width : 0;
    const height = typeof obj.height === 'number' ? obj.height : 0;
    const fileSize = typeof obj.fileSize === 'number' ? obj.fileSize : 0;
    const originalName =
      typeof obj.originalName === 'string' ? obj.originalName : null;
    const focalPointX =
      typeof obj.focalPointX === 'number' &&
      obj.focalPointX >= 0 &&
      obj.focalPointX <= 1
        ? obj.focalPointX
        : 0.5;
    const focalPointY =
      typeof obj.focalPointY === 'number' &&
      obj.focalPointY >= 0 &&
      obj.focalPointY <= 1
        ? obj.focalPointY
        : 0.5;
    return {
      storageKey: obj.storageKey,
      mimeType,
      width,
      height,
      fileSize,
      originalName,
      focalPointX,
      focalPointY,
    };
  }

  interface RichTextShape {
    json: unknown;
  }

  const RichTextRef = builder.objectRef<RichTextShape>('RichText').implement({
    fields: (t) => ({
      json: t.field({
        type: 'JSON',
        resolve: (rt) => rt.json,
      }),
      references: t.field({
        type: [ContentEntryInterface],
        nullable: false,
        // RICHTEXT references is a batched lookup over the body's
        // dedup'd entry refs. Bump base cost to reflect the
        // per-traversal Prisma round-trip; multiplier inherits the
        // schema-level default for list-returning fields.
        complexity: 10,
        resolve: async (rt) => {
          const refs = collectRichtextReferences(rt.json);
          if (refs.length === 0) return [];
          const entryIds = refs.map((r) => r.entryId);
          const entries = await prisma.contentEntry.findMany({
            where: { id: { in: entryIds } },
            include: { versions: { where: { status: 'PUBLISHED' } } },
          });
          const byId = new Map<string, ContentEntryShape>();
          for (const e of entries) {
            if (e.versions.length === 0) continue;
            if (!typeIdToIdentifier.has(e.contentTypeId)) continue;
            byId.set(e.id, flattenToShape(e, e.versions[0]!));
          }
          return refs
            .map((r) => byId.get(r.entryId))
            .filter((e): e is ContentEntryShape => Boolean(e));
        },
      }),
    }),
  });

  const dynFilters = registerDynamicFilterInputs(builder, ContentStatusEnum);

  const typeRefs = new Map<string, ReturnType<Builder['objectRef']>>();

  // PASS 1: reserve a Where inputRef per content type so per-relation filter
  // inputs can forward-reference their target's Where via closure. Pothos
  // resolves field-callback references at schema-build time, so refs created
  // here can be used in implement() callbacks below regardless of order.
  const whereInputRefs = new Map<string, ReturnType<Builder['inputRef']>>();
  for (const ct of contentTypes) {
    whereInputRefs.set(
      ct.id,
      builder.inputRef<Record<string, unknown>>(`${ct.identifier}Where`)
    );
  }

  for (const ct of contentTypes) {
    const scalarFields = ct.fields.filter(
      (f) => FIELD_TYPE_TO_SCALAR[f.type] !== undefined
    );

    const filterableFields = ct.fields.filter(
      (f) => getFilterKeyForFieldType(f.type) !== null
    );

    // Per-(content-type, field) filter inputs for single-target RELATION /
    // MULTIRELATION fields. These add `is` / `some` referencing the target
    // type's Where in addition to the flat operators from PR #140.
    // Polymorphic (multi-target) and unset fields keep the shared
    // DynRelationFilter / DynMultirelationFilter from jsonbFilters.ts.
    const perRelationFilters = new Map<
      string,
      ReturnType<Builder['inputType']>
    >();
    for (const field of filterableFields) {
      if (field.type !== 'RELATION' && field.type !== 'MULTIRELATION') continue;
      const opts = parseFieldOptions(field);
      const targetIds =
        opts.type === 'RELATION' || opts.type === 'MULTIRELATION'
          ? opts.targetContentTypeIds
          : [];
      if (targetIds.length !== 1) continue;
      const targetRef = whereInputRefs.get(targetIds[0]!);
      if (!targetRef) continue;

      const pascalField =
        field.identifier.charAt(0).toUpperCase() + field.identifier.slice(1);
      const inputName =
        field.type === 'RELATION'
          ? `${ct.identifier}${pascalField}RelationFilter`
          : `${ct.identifier}${pascalField}MultirelationFilter`;

      const ref = builder.inputType(inputName, {
        fields: (t) => {
          if (field.type === 'RELATION') {
            return {
              equals: t.id(),
              in: t.idList(),
              isNull: t.boolean(),
              is: t.field({ type: targetRef as never }),
            } as never;
          }
          return {
            contains: t.id(),
            containsAny: t.idList(),
            containsAll: t.idList(),
            isEmpty: t.boolean(),
            some: t.field({ type: targetRef as never }),
          } as never;
        },
      });
      perRelationFilters.set(field.id, ref);
    }

    const whereRef = whereInputRefs.get(ct.id)!;
    const WhereInput = builder.inputType(whereRef as never, {
      fields: (t) => {
        const whereFields: Record<string, unknown> = {
          status: t.field({ type: dynFilters.DynContentStatusFilter }),
          entryKey: t.field({ type: dynFilters.DynEntryKeyFilter }),
          createdAt: t.field({ type: dynFilters.DynDateTimeFilter }),
          updatedAt: t.field({ type: dynFilters.DynDateTimeFilter }),
        };
        for (const field of filterableFields) {
          const perRel = perRelationFilters.get(field.id);
          if (perRel) {
            whereFields[field.identifier] = t.field({ type: perRel as never });
            continue;
          }
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
          entryKey: t.string({ resolve: (entry) => entry.entryKey }),
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
            const data = parseEntryData(entry);
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

        // RICHTEXT fields (object type with json + references)
        const richtextFields = ct.fields.filter((f) => f.type === 'RICHTEXT');
        for (const field of richtextFields) {
          fields[field.identifier] = t.field({
            type: RichTextRef,
            nullable: !field.required,
            resolve: (entry: ContentEntryShape) => {
              const data = parseEntryData(entry);
              const json = data?.[field.identifier];
              if (json == null) return null;
              return { json };
            },
          }) as never;
        }

        // IMAGE fields (object type with file metadata + derived url)
        const imageFields = ct.fields.filter((f) => f.type === 'IMAGE');
        for (const field of imageFields) {
          fields[field.identifier] = t.field({
            type: ImageFileRef,
            nullable: !field.required,
            resolve: (entry: ContentEntryShape) =>
              readImageField(entry, field.identifier),
          }) as never;
        }

        // RELATION fields (single polymorphic reference)
        const relationFields = ct.fields.filter((f) => f.type === 'RELATION');
        for (const field of relationFields) {
          const opts = parseFieldOptions(field);
          const targetIds =
            opts.type === 'RELATION' ? opts.targetContentTypeIds : [];

          const resolveRef = async (entry: ContentEntryShape) => {
            const data = parseEntryData(entry);
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
              // RELATION traversal triggers a Prisma findUnique per
              // resolution. Bump base cost to discourage deep chains.
              complexity: 5,
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
              complexity: 5,
              resolve: resolveRef as never,
            });
          }
        }

        // MULTIRELATION fields (ordered list of polymorphic references)
        const multiRelationFields = ct.fields.filter(
          (f) => f.type === 'MULTIRELATION'
        );
        for (const field of multiRelationFields) {
          const opts = parseFieldOptions(field);
          const targetIds =
            opts.type === 'MULTIRELATION' ? opts.targetContentTypeIds : [];

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
            // MULTIRELATION is a fan-out: each connection traversal
            // hits Prisma for N rows. Base cost reflects the cross-
            // entry boundary; the `edges` list inside the Connection
            // picks up the schema-level defaultListMultiplier.
            complexity: { field: 5 },
            resolve: (entry: ContentEntryShape, args: unknown) =>
              resolveOffsetConnection(
                {
                  args: args as Parameters<
                    typeof resolveOffsetConnection
                  >[0]['args'],
                },
                async ({ limit, offset }) => {
                  const data = parseEntryData(entry);
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
              contentTypes,
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

    // entryKey lookup — unconditional, every entry has an entryKey (#205).
    builder.queryField(`${camelName}ByEntryKey`, (t) =>
      t.field({
        type: ref,
        nullable: true,
        args: { entryKey: t.arg.string({ required: true }) },
        resolve: async (_root, args) => {
          const entry = await prisma.contentEntry.findFirst({
            where: { contentTypeId: ct.id, entryKey: args.entryKey },
            include: { versions: { where: { status: 'PUBLISHED' } } },
          });
          if (!entry || entry.versions.length === 0) return null;
          return flattenToShape(entry, entry.versions[0]!);
        },
      })
    );
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
            SELECT e."id", e."contentTypeId", v."data", e."slug", e."entryKey",
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
