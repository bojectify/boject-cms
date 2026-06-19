/**
 * Content-type field identifiers that collide with the built-in GraphQL
 * `ContentEntry` envelope fields registered by `registerDynamicTypes`
 * (`apps/cms/server/graphql/dynamicTypes.ts`). A user field with
 * any of these identifiers would overwrite the envelope field — crashing the
 * schema build (type mismatch, e.g. a SELECT `status` vs the interface's
 * `ContentStatus`) or silently shadowing it (same type). KEEP IN SYNC: adding
 * an envelope field there means adding it here (a test enforces the count).
 */
export const RESERVED_FIELD_IDENTIFIERS = [
  'id',
  'entryKey',
  'contentType',
  'status',
  'publishedAt',
  'createdAt',
  'updatedAt',
] as const;

export type ReservedFieldIdentifier =
  (typeof RESERVED_FIELD_IDENTIFIERS)[number];

const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED_FIELD_IDENTIFIERS);

export function isReservedFieldIdentifier(identifier: string): boolean {
  return RESERVED_SET.has(identifier);
}
