import type { H3Event } from 'h3';
import type { ContentEntryVersion, ContentEntry, ContentStatus } from '#prisma';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

export function isCmsRequest(event: H3Event): boolean {
  return event.context.authMethod === 'session';
}

export function getDraftVersion<V extends { status: ContentStatus }>(
  versions: V[]
): V | null {
  return (
    versions.find((v) => v.status === CONTENT_STATUSES.CHANGED) ??
    versions.find((v) => v.status === CONTENT_STATUSES.DRAFT) ??
    null
  );
}

export function getPublishedVersion<V extends { status: ContentStatus }>(
  versions: V[]
): V | null {
  return versions.find((v) => v.status === CONTENT_STATUSES.PUBLISHED) ?? null;
}

export function getVersionForContext<V extends { status: ContentStatus }>(
  versions: V[],
  isCms: boolean
): V | null {
  if (isCms) {
    return getDraftVersion(versions) ?? getPublishedVersion(versions);
  }
  return getPublishedVersion(versions);
}

export function flattenEntryWithVersion(
  entry: ContentEntry & { versions?: ContentEntryVersion[] },
  version: Pick<
    ContentEntryVersion,
    'data' | 'status' | 'publishedAt' | 'createdBy' | 'updatedBy'
  >,
  extras?: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: entry.id,
    contentTypeId: entry.contentTypeId,
    data: version.data,
    entryTitle: entry.entryTitle,
    entryKey: entry.entryKey,
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
