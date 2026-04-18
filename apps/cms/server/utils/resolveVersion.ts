import type { H3Event } from 'h3';
import type { ContentEntryVersion, ContentEntry } from '#prisma';

export function isCmsRequest(event: H3Event): boolean {
  return event.context.authMethod === 'session';
}

export function getDraftVersion(
  versions: ContentEntryVersion[]
): ContentEntryVersion | null {
  return (
    versions.find((v) => v.status === 'CHANGED') ??
    versions.find((v) => v.status === 'DRAFT') ??
    null
  );
}

export function getPublishedVersion(
  versions: ContentEntryVersion[]
): ContentEntryVersion | null {
  return versions.find((v) => v.status === 'PUBLISHED') ?? null;
}

export function getVersionForContext(
  versions: ContentEntryVersion[],
  isCms: boolean
): ContentEntryVersion | null {
  if (isCms) {
    return getDraftVersion(versions) ?? getPublishedVersion(versions);
  }
  return getPublishedVersion(versions);
}

export function flattenEntryWithVersion(
  entry: ContentEntry & { versions?: ContentEntryVersion[] },
  version: ContentEntryVersion,
  extras?: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: entry.id,
    contentTypeId: entry.contentTypeId,
    data: version.data,
    entryTitle: entry.entryTitle,
    slug: entry.slug,
    status: version.status,
    publishedAt: version.publishedAt,
    createdBy: version.createdBy,
    updatedBy: version.updatedBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...extras,
  };
}
