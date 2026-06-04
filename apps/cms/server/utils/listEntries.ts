import type { Prisma, ContentStatus, PrismaClient } from '#prisma';
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

export interface FullReducedVersion {
  id: string;
  entryId: string;
  status: ContentStatus;
  data: Prisma.JsonValue;
  publishedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
}
export type StatusOnlyVersion = Pick<
  FullReducedVersion,
  'id' | 'entryId' | 'status'
>;

export async function fetchDisplayVersions(
  prisma: PrismaClient,
  entryIds: string[],
  opts: { includeData: true }
): Promise<Map<string, FullReducedVersion[]>>;
export async function fetchDisplayVersions(
  prisma: PrismaClient,
  entryIds: string[],
  opts: { includeData: false }
): Promise<Map<string, StatusOnlyVersion[]>>;
export async function fetchDisplayVersions(
  prisma: PrismaClient,
  entryIds: string[],
  opts: { includeData: boolean }
): Promise<Map<string, (FullReducedVersion | StatusOnlyVersion)[]>> {
  if (entryIds.length === 0) return new Map();

  // DISTINCT ON (entryId, status), latest-by-updatedAt within each group.
  // Bounds the fetch to <=1 row per status per entry (<=4/entry) regardless of
  // how many ARCHIVED versions exist. Distinct columns must lead the orderBy.
  const rows = opts.includeData
    ? await prisma.contentEntryVersion.findMany({
        where: { entryId: { in: entryIds } },
        distinct: ['entryId', 'status'],
        orderBy: [{ entryId: 'asc' }, { status: 'asc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          entryId: true,
          status: true,
          data: true,
          publishedAt: true,
          createdBy: true,
          updatedBy: true,
        },
      })
    : await prisma.contentEntryVersion.findMany({
        where: { entryId: { in: entryIds } },
        distinct: ['entryId', 'status'],
        orderBy: [{ entryId: 'asc' }, { status: 'asc' }, { updatedAt: 'desc' }],
        select: { id: true, entryId: true, status: true },
      });

  const byEntry = new Map<string, (FullReducedVersion | StatusOnlyVersion)[]>();
  for (const row of rows) {
    const arr = byEntry.get(row.entryId);
    if (arr) arr.push(row);
    else byEntry.set(row.entryId, [row]);
  }
  return byEntry;
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
