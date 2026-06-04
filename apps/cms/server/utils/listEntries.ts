import type { Prisma } from '#prisma';
import {
  CONTENT_STATUSES,
  type ContentStatusName,
} from '../../utils/contentStatus';

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
