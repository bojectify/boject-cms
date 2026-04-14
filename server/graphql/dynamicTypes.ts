import type { Builder } from './builder';
import type { ContentStatusEnumRef } from './types/contentStatus';
import { resolveOffsetConnection } from '@pothos/plugin-relay';
import { prisma } from '../utils/prisma';

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

  const typeRefs = new Map<string, ReturnType<Builder['objectRef']>>();

  for (const ct of contentTypes) {
    const scalarFields = ct.fields.filter(
      (f) => FIELD_TYPE_TO_SCALAR[f.type] !== undefined
    );

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

        return fields as never;
      },
    });
    typeRefs.set(ct.id, implRef);

    const camelName = toCamelCase(ct.identifier);

    builder.queryField(`${camelName}List`, (t) =>
      t.connection({
        type: ref,
        resolve: (_root, args) =>
          resolveOffsetConnection({ args }, async ({ limit, offset }) => {
            return prisma.contentEntry.findMany({
              where: { contentTypeId: ct.id },
              take: limit,
              skip: offset,
              orderBy: { createdAt: 'desc' },
            });
          }),
      })
    );

    builder.queryField(camelName, (t) =>
      t.field({
        type: ref,
        nullable: true,
        args: { id: t.arg.id({ required: true }) },
        resolve: async (_root, args) => {
          return prisma.contentEntry.findFirst({
            where: { id: String(args.id), contentTypeId: ct.id },
          });
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
            return prisma.contentEntry.findFirst({
              where: { contentTypeId: ct.id, slug: args.slug },
            });
          },
        })
      );
    }
  }

  return { typeRefs, ContentEntryInterface, typeIdToIdentifier };
}
