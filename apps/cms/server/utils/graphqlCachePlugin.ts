import { createHash } from 'node:crypto';
import { print, type DocumentNode } from 'graphql';
import { decodeCollected } from './entryTagCollector';

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
