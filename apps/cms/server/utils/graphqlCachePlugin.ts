import { createHash } from 'node:crypto';
import type { Plugin } from 'graphql-yoga';
import { isAsyncIterable } from 'graphql-yoga';
import {
  getOperationAST,
  print,
  type DocumentNode,
  type ExecutionResult,
} from 'graphql';
import { setResponseHeader } from 'h3';
import { taggedCache, type TaggedCache } from './taggedCache';
import { getContentTypeIdentifierMap } from '../graphql/schema';
import {
  resolvePublicCacheTtl,
  resolveGraphqlCacheMaxBytes,
} from './cacheConfig';
import { decodeCollected, withEntryCollection } from './entryTagCollector';
import type { YogaServerContext } from './yogaContext';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** JSON.stringify with recursively-sorted object keys, so semantically-equal
 *  variable objects hash to the same cache key regardless of property order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`
    )
    .join(',');
  return `{${body}}`;
}

export function buildCacheKey(
  document: DocumentNode,
  variableValues: Record<string, unknown> | null | undefined,
  operationName: string | null | undefined
): string {
  const queryHash = sha256(print(document));
  const varsHash = sha256(stableStringify(variableValues ?? {}));
  return `gql:${operationName ?? ''}:${queryHash}:${varsHash}`;
}

export function buildTags(
  collected: Set<string>,
  identifierById: Map<string, string>
): string[] {
  const tags = new Set<string>();
  for (const { contentTypeId, id } of decodeCollected(collected)) {
    const identifier = identifierById.get(contentTypeId);
    if (!identifier) continue; // defensive: unknown/stale type id
    tags.add(`content-type:${identifier}`);
    tags.add(`entry:${identifier}:${id}`);
  }
  return [...tags];
}

export interface GraphqlCacheDeps {
  cache: TaggedCache;
  ttl: () => number;
  maxBytes: () => number;
  identifierMap: () => Promise<Map<string, string>>;
}

/**
 * GraphQL response cache (#260). Cache-aside over the #258 tagged cache:
 * - onExecute: for an eligible (authenticated, non-dev-GraphiQL) query, serve a
 *   stored ExecutionResult via setResultAndStopExecution (HIT) or wrap execution
 *   in an entry-collection scope (MISS).
 * - onExecuteDone: on a successful, non-streaming, under-cap MISS, tag with every
 *   harvested entry and store.
 * Skips: mutations/subscriptions, errored results, streamed results, oversize
 * responses, and the unauthenticated dev-GraphiQL path (no gqlCacheEligible flag).
 * Caching is never a correctness dependency — a read error serves origin (BYPASS).
 */
export function createGraphqlCachePlugin(
  deps: GraphqlCacheDeps
): Plugin<YogaServerContext> {
  return {
    async onExecute({
      args,
      setResultAndStopExecution,
      setExecuteFn,
      executeFn,
    }) {
      const ctx = args.contextValue as Partial<YogaServerContext>;
      const event = ctx.event;
      // Only the authenticated path sets this flag (see graphql.ts). The
      // unauthenticated dev-GraphiQL request is never cached.
      if (!event || event.context?.gqlCacheEligible !== true) return;

      const op = getOperationAST(
        args.document,
        args.operationName ?? undefined
      );
      if (!op || op.operation !== 'query') return; // mutations/subscriptions

      const key = buildCacheKey(
        args.document,
        args.variableValues,
        args.operationName
      );

      // 1. Try to serve from cache. A read error is non-fatal: BYPASS + origin.
      let cached: ExecutionResult | null;
      try {
        cached = await deps.cache.get<ExecutionResult>(key);
      } catch (err) {
        console.warn('[gql-cache] get failed, serving from origin', err);
        setResponseHeader(event, 'X-Cache', 'BYPASS');
        return;
      }
      if (cached !== null && cached !== undefined) {
        setResponseHeader(event, 'X-Cache', 'HIT');
        setResultAndStopExecution(cached);
        return;
      }

      // 2. Miss: run execution inside an entry-collection scope, write on done.
      const collected = new Set<string>();
      setExecuteFn((execArgs) =>
        withEntryCollection(collected, () => executeFn(execArgs))
      );

      return {
        async onExecuteDone({ result }) {
          setResponseHeader(event, 'X-Cache', 'MISS');
          // Don't cache streams or errored results.
          if (isAsyncIterable(result)) return;
          if (result.errors && result.errors.length > 0) return;

          let serialized: string;
          try {
            serialized = JSON.stringify(result);
          } catch {
            return; // non-serialisable — skip
          }
          if (Buffer.byteLength(serialized) > deps.maxBytes()) return;

          let identifierById: Map<string, string>;
          try {
            identifierById = await deps.identifierMap();
          } catch (err) {
            console.warn('[gql-cache] identifier map failed, not caching', err);
            return;
          }
          const tags = buildTags(collected, identifierById);
          try {
            await deps.cache.set(key, result, { tags, ttl: deps.ttl() });
          } catch (err) {
            console.warn('[gql-cache] set failed (best-effort)', err);
          }
        },
      };
    },
  };
}

export const graphqlCachePlugin: Plugin<YogaServerContext> =
  createGraphqlCachePlugin({
    cache: taggedCache,
    ttl: resolvePublicCacheTtl,
    maxBytes: resolveGraphqlCacheMaxBytes,
    identifierMap: getContentTypeIdentifierMap,
  });
