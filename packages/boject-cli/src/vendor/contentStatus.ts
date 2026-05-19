// Canonical registry of content entry statuses. Mirrors the `ContentStatus`
// enum in apps/cms/prisma/schema/base.prisma so that resolvers, validators,
// API handlers, GraphQL types, and tests all read from one source. Pure module
// (zero Nuxt / Prisma deps) so it ships unchanged into packages/boject-cli
// via vendor copy — keep packages/boject-cli/src/vendor/contentStatus.ts in sync.

export const CONTENT_STATUSES = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CHANGED: 'CHANGED',
  ARCHIVED: 'ARCHIVED',
} as const;

export const CONTENT_STATUS_NAMES = Object.values(CONTENT_STATUSES);

export type ContentStatusName =
  (typeof CONTENT_STATUSES)[keyof typeof CONTENT_STATUSES];

export const CONTENT_STATUSES_SET: ReadonlySet<ContentStatusName> = new Set(
  CONTENT_STATUS_NAMES
);

export function isContentStatusName(
  value: unknown
): value is ContentStatusName {
  return (
    typeof value === 'string' &&
    CONTENT_STATUSES_SET.has(value as ContentStatusName)
  );
}
