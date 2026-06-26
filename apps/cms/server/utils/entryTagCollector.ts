import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped harvest of every ContentEntry resolved during one GraphQL
 * execution. The GraphQL cache plugin (#260) opens a scope around execution;
 * `flattenToShape` (the single chokepoint every resolved entry passes through)
 * calls `recordResolvedEntry`. Route B of the #260 design — chokepoint
 * instrumentation, chosen over `@envelop/on-resolve` to avoid a new dependency.
 */
const als = new AsyncLocalStorage<Set<string>>();

// NUL can't appear in a UUID or our identifiers, so it's a safe join byte.
const SEP = '\0';

export function recordResolvedEntry(contentTypeId: string, id: string): void {
  const store = als.getStore();
  if (store) store.add(`${contentTypeId}${SEP}${id}`);
}

export function withEntryCollection<T>(collected: Set<string>, fn: () => T): T {
  return als.run(collected, fn);
}

export function decodeCollected(
  collected: Set<string>
): Array<{ contentTypeId: string; id: string }> {
  return [...collected].map((member) => {
    const parts = member.split(SEP);
    return { contentTypeId: parts[0]!, id: parts[1]! };
  });
}
