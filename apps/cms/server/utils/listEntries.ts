import type {
  Prisma,
  ContentStatus,
  PrismaClient,
  ContentEntry,
} from '#prisma';
import {
  CONTENT_STATUSES,
  type ContentStatusName,
} from '../../utils/contentStatus';
import {
  getVersionForContext,
  flattenEntryWithVersion,
} from './resolveVersion';
import { projectEntryDataColumns } from './projectEntryColumns';
import { hydrateRelationColumns } from './hydrateRelationColumns';
import type { resolveContentTypeFieldTypesById } from './searchFieldTypes';
import { isUuid } from './validation';

type FieldTypeMap = Awaited<
  ReturnType<typeof resolveContentTypeFieldTypesById>
>;

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
  // The trailing `{ id: 'asc' }` makes the DISTINCT ON winner a total order, so
  // two rows sharing the same `updatedAt` resolve deterministically rather than
  // letting Postgres pick arbitrarily.
  //
  // The `entryId IN (...)` lookup is intentionally not separately indexed here:
  // a covering index on ContentEntryVersion is deferred to #256 (the cursor /
  // covering-index work), and this change must not add a migration. entryIds is
  // bounded to one page (<= perPage <= 100), and this already fetches strictly
  // fewer rows than the `versions: true` eager-load it replaces, so it is a
  // pure improvement over the prior plan at current scale.
  const rows = opts.includeData
    ? await prisma.contentEntryVersion.findMany({
        where: { entryId: { in: entryIds } },
        distinct: ['entryId', 'status'],
        orderBy: [
          { entryId: 'asc' },
          { status: 'asc' },
          { updatedAt: 'desc' },
          { id: 'asc' },
        ],
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
        orderBy: [
          { entryId: 'asc' },
          { status: 'asc' },
          { updatedAt: 'desc' },
          { id: 'asc' },
        ],
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

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

/** Opaque forward/backward cursor over (updatedAt, id). `updatedAt` is
 *  timestamp(3) so epoch-ms round-trips exactly; id is a UUID (no `_`), so the
 *  first `_` is an unambiguous separator. */
export function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.getTime()}_${id}`).toString('base64url');
}

export function decodeCursor(
  cursor: string
): { updatedAt: Date; id: string } | null {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = raw.indexOf('_');
  if (sep <= 0) return null;
  const ms = Number(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (!isUuid(id)) return null;
  return { updatedAt: new Date(ms), id };
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export const EMPTY_PAGE_INFO: PageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

export interface KeysetPageArgs {
  where: Prisma.ContentEntryWhereInput;
  perPage: number;
  after?: string | null;
  before?: string | null;
  select?: Prisma.ContentEntrySelect;
}

/** Bidirectional keyset over (updatedAt DESC, id ASC). Pass `after` (forward) or
 *  `before` (backward); presentation order is always updatedAt DESC, id ASC.
 *  Fetches perPage+1 to probe the far edge; the near edge is inferred from the
 *  presence of the cursor (acceptable for button nav — see spec edge note). */
export async function keysetPage<T extends { id: string; updatedAt: Date }>(
  prisma: PrismaClient,
  args: KeysetPageArgs
): Promise<{ rows: T[]; pageInfo: PageInfo }> {
  const { where: baseWhere, perPage, after, before, select } = args;
  const backward = !!before && !after;
  const token = backward ? before : after;
  const cursor = token ? decodeCursor(token) : null;
  if (token && !cursor) throw new InvalidCursorError();

  const keysetWhere: Prisma.ContentEntryWhereInput | null = cursor
    ? backward
      ? {
          OR: [
            { updatedAt: { gt: cursor.updatedAt } },
            { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
          ],
        }
      : {
          OR: [
            { updatedAt: { lt: cursor.updatedAt } },
            { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
          ],
        }
    : null;

  const where = keysetWhere ? { AND: [baseWhere, keysetWhere] } : baseWhere;
  const orderBy: Prisma.ContentEntryOrderByWithRelationInput[] = backward
    ? [{ updatedAt: 'asc' }, { id: 'desc' }]
    : [{ updatedAt: 'desc' }, { id: 'asc' }];

  const findArgs: Prisma.ContentEntryFindManyArgs = {
    where,
    orderBy,
    take: perPage + 1,
  };
  if (select) findArgs.select = select;

  // Prisma's findMany result type for the dynamic findArgs has no structural
  // overlap with the caller-supplied generic T (which the caller pins to the
  // shape its `select` projects), so the double cast is intentional.
  // eslint-disable-next-line no-restricted-syntax
  const fetched = (await prisma.contentEntry.findMany(
    findArgs
  )) as unknown as T[];
  const hasExtra = fetched.length > perPage;
  let rows = hasExtra ? fetched.slice(0, perPage) : fetched;
  if (backward) rows = rows.reverse();

  const first = rows[0];
  const last = rows[rows.length - 1];
  const startCursor = first ? encodeCursor(first.updatedAt, first.id) : null;
  const endCursor = last ? encodeCursor(last.updatedAt, last.id) : null;

  const pageInfo: PageInfo = backward
    ? { hasPreviousPage: hasExtra, hasNextPage: true, startCursor, endCursor }
    : {
        hasNextPage: hasExtra,
        hasPreviousPage: !!after,
        startCursor,
        endCursor,
      };

  return { rows, pageInfo };
}

export interface ResolveEntriesCtx {
  isCms: boolean;
  archiveFilter: ArchiveFilter;
  columns?: string[];
  fieldTypes?: FieldTypeMap;
}

/** Per-entry: pick the context-appropriate version (≤1 DB query for all rows
 *  via fetchDisplayVersions), flatten it onto the envelope, optionally project +
 *  hydrate data-grid `columns`. Shared by /api/entries and the public endpoint
 *  (#256). Rows with no resolvable version are dropped. */
export async function resolveAndFlattenEntries(
  prisma: PrismaClient,
  envelopeRows: ContentEntry[],
  ctx: ResolveEntriesCtx
): Promise<
  Array<Record<string, unknown> & { fields?: Record<string, unknown> }>
> {
  const versionsByEntry = await fetchDisplayVersions(
    prisma,
    envelopeRows.map((e) => e.id),
    { includeData: true }
  );
  const items = envelopeRows
    .map((entry) => {
      const version = resolveDisplayVersion(
        versionsByEntry.get(entry.id) ?? [],
        {
          isCms: ctx.isCms,
          archiveFilter: ctx.archiveFilter,
        }
      );
      if (!version) return null;
      return flattenEntryWithVersion(
        entry,
        version,
        ctx.columns?.length
          ? {
              fields: projectEntryDataColumns(
                version.data,
                ctx.columns,
                ctx.fieldTypes!
              ),
            }
          : undefined
      );
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (ctx.columns?.length) {
    await hydrateRelationColumns(items, ctx.columns, ctx.fieldTypes!);
  }
  return items;
}
