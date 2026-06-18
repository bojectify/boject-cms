import { assertUuid } from '../utils/validation';
import { isCmsRequest } from '../utils/resolveVersion';
import {
  CONTENT_STATUS_NAMES,
  type ContentStatusName,
} from '../../utils/contentStatus';
import {
  buildEntryListWhere,
  parseArchiveFilter,
  resolveAndFlattenEntries,
} from '../utils/listEntries';
import {
  parseColumnsParam,
  filterColumnableColumns,
} from '../../utils/searchColumns';
import { resolveContentTypeFieldTypesById } from '../utils/searchFieldTypes';

const VALID_STATUSES = new Set<string>(CONTENT_STATUS_NAMES);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  if (!query.contentTypeId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'contentTypeId is required',
    });
  }
  const contentTypeId = assertUuid(query.contentTypeId, 'contentTypeId');

  // Data-grid columns: resolve the type's field-type map only when columns were
  // requested, then keep just the columnable ids. Mirrors /api/search so the
  // emitted `fields` map is byte-identical (browse-mode parity, #303).
  const requestedColumns = parseColumnsParam(query.columns);
  const fieldTypes = requestedColumns.length
    ? await resolveContentTypeFieldTypesById(contentTypeId)
    : {};
  const columns = filterColumnableColumns(requestedColumns, fieldTypes);

  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));

  const isCms = isCmsRequest(event);
  const archiveFilter = parseArchiveFilter(query.archiveFilter);

  const status =
    typeof query.status === 'string' && VALID_STATUSES.has(query.status)
      ? (query.status as ContentStatusName)
      : null;

  const where = buildEntryListWhere({
    isCms,
    archiveFilter,
    status,
    contentTypeId,
  });

  const [entries, total] = await Promise.all([
    prisma.contentEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.contentEntry.count({ where }),
  ]);

  const items = await resolveAndFlattenEntries(prisma, entries, {
    isCms,
    archiveFilter,
    columns,
    fieldTypes,
  });

  return { items, total };
});
