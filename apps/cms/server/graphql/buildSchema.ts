import type { GraphQLSchema } from 'graphql';
import { createBuilder } from './builder';
import { registerContentStatusEnum } from './types/contentStatus';
import { registerDynamicTypes } from './dynamicTypes';
import { registerSearchQuery } from './searchQuery';
import { prisma } from '../utils/prisma';

export async function buildSchema(): Promise<GraphQLSchema> {
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

  return builder.toSchema();
}
