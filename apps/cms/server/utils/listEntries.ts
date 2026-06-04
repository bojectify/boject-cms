import type { Prisma, ContentStatus } from '#prisma';
import {
  CONTENT_STATUSES,
  type ContentStatusName,
} from '../../utils/contentStatus';
import { getVersionForContext } from './resolveVersion';

export const VALID_ARCHIVE_FILTERS = ['active', 'archived', 'all'] as const;
export type ArchiveFilter = (typeof VALID_ARCHIVE_FILTERS)[number];

export function parseArchiveFilter(value: unknown): ArchiveFilter {
  return typeof value === 'string' &&
    (VALID_ARCHIVE_FILTERS as readonly string[]).includes(value)
    ? (value as ArchiveFilter)
    : 'active';
}

export interface EntryListWhereOpts {
  isCms: boolean;
  archiveFilter: ArchiveFilter;
  status?: ContentStatusName | null;
  contentTypeId?: string | null;
}

export function buildEntryListWhere(
  opts: EntryListWhereOpts
): Prisma.ContentEntryWhereInput {
  const { isCms, archiveFilter, status, contentTypeId } = opts;
  const where: Prisma.ContentEntryWhereInput = {};
  if (contentTypeId) where.contentTypeId = contentTypeId;

  if (isCms) {
    if (status) {
      where.versions = { some: { status } };
    } else if (archiveFilter === 'archived') {
      where.versions = { some: { status: CONTENT_STATUSES.ARCHIVED } };
    } else if (archiveFilter === 'active') {
      where.versions = { none: { status: CONTENT_STATUSES.ARCHIVED } };
    }
    // 'all': no version constraint
  } else {
    where.versions = { some: { status: CONTENT_STATUSES.PUBLISHED } };
  }
  return where;
}

export function resolveDisplayVersion<V extends { status: ContentStatus }>(
  versions: V[],
  opts: { isCms: boolean; archiveFilter: ArchiveFilter }
): V | null {
  const { isCms, archiveFilter } = opts;
  if (isCms && archiveFilter === 'archived') {
    return versions.find((v) => v.status === CONTENT_STATUSES.ARCHIVED) ?? null;
  }
  let version = getVersionForContext(versions, isCms);
  if (!version && isCms && archiveFilter === 'all') {
    version =
      versions.find((v) => v.status === CONTENT_STATUSES.ARCHIVED) ?? null;
  }
  return version ?? null;
}
