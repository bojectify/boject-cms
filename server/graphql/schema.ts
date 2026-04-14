import type { GraphQLSchema } from 'graphql';
import { buildSchema } from './buildSchema';

let cachedSchema: GraphQLSchema | null = null;
let buildPromise: Promise<GraphQLSchema> | null = null;

export async function getSchema(): Promise<GraphQLSchema> {
  if (cachedSchema) return cachedSchema;

  // Prevent concurrent builds
  if (!buildPromise) {
    buildPromise = buildSchema().then((schema) => {
      cachedSchema = schema;
      buildPromise = null;
      return schema;
    });
  }

  return buildPromise;
}

export function invalidateSchema(): void {
  cachedSchema = null;
  buildPromise = null;
}
