import type { GraphQLSchema } from 'graphql';
import { createBuilder } from './builder';
import { registerContentStatusEnum } from './types/contentStatus';
import { registerDynamicTypes } from './dynamicTypes';
import { registerSearchQuery } from './searchQuery';
import { prisma } from '../utils/prisma';

export interface BuiltSchema {
  schema: GraphQLSchema;
  /** contentTypeId (UUID) → PascalCase identifier, for cache tag formatting. */
  identifierById: Map<string, string>;
}

export async function buildSchema(): Promise<BuiltSchema> {
  const builder = createBuilder();

  // Query root must be declared so Pothos (and the Relay plugin) have a
  // concrete implementation to attach dynamic queryField extensions to.
  builder.queryType({});

  const ContentStatusEnum = registerContentStatusEnum(builder);

  const contentTypes = await prisma.contentType.findMany({
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  registerDynamicTypes(builder, contentTypes, ContentStatusEnum);
  registerSearchQuery(builder);

  const identifierById = new Map(
    contentTypes.map((ct) => [ct.id, ct.identifier])
  );

  return { schema: builder.toSchema(), identifierById };
}
