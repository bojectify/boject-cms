import type { GraphQLSchema } from 'graphql';
import { buildSchema, type BuiltSchema } from './buildSchema';

let cached: BuiltSchema | null = null;
let buildPromise: Promise<BuiltSchema> | null = null;

function build(): Promise<BuiltSchema> {
  // Prevent concurrent builds.
  if (!buildPromise) {
    buildPromise = buildSchema().then((built) => {
      cached = built;
      buildPromise = null;
      return built;
    });
  }
  return buildPromise;
}

export async function getSchema(): Promise<GraphQLSchema> {
  if (cached) return cached.schema;
  return (await build()).schema;
}

export async function getContentTypeIdentifierMap(): Promise<
  Map<string, string>
> {
  if (cached) return cached.identifierById;
  return (await build()).identifierById;
}

export function invalidateSchema(): void {
  cached = null;
  buildPromise = null;
}
