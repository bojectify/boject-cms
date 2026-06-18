import { isCmsRequest } from '../utils/resolveVersion';
import {
  CONTENT_STATUS_NAMES,
  type ContentStatusName,
} from '../../utils/contentStatus';
import {
  buildEntryListWhere,
  parseArchiveFilter,
  resolveAndFlattenEntries,
  keysetPage,
  EMPTY_PAGE_INFO,
  InvalidCursorError,
} from '../utils/listEntries';
import { resolveContentTypeIdParam } from '../utils/resolveContentTypeId';
import {
  parseColumnsParam,
  filterColumnableColumns,
} from '../../utils/searchColumns';
import { resolveContentTypeFieldTypesById } from '../utils/searchFieldTypes';
import type { ContentEntry } from '#prisma';

const VALID_STATUSES = new Set<string>(CONTENT_STATUS_NAMES);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  const contentTypeId = await resolveContentTypeIdParam(prisma, query);
  if (contentTypeId === null) return { items: [], pageInfo: EMPTY_PAGE_INFO };

  // Data-grid columns: resolve the type's field-type map only when columns were
  // requested, then keep just the columnable ids. Mirrors /api/search so the
  // emitted `fields` map is byte-identical (browse-mode parity, #303).
  const requestedColumns = parseColumnsParam(query.columns);
  const fieldTypes = requestedColumns.length
    ? await resolveContentTypeFieldTypesById(contentTypeId)
    : {};
  const columns = filterColumnableColumns(requestedColumns, fieldTypes);

  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));
  const after = typeof query.after === 'string' ? query.after : null;
  const before = typeof query.before === 'string' ? query.before : null;

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

  let page;
  try {
    page = await keysetPage<ContentEntry>(prisma, {
      where,
      perPage,
      after,
      before,
    });
  } catch (e) {
    if (e instanceof InvalidCursorError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cursor' });
    }
    throw e;
  }

  const items = await resolveAndFlattenEntries(prisma, page.rows, {
    isCms,
    archiveFilter,
    columns,
    fieldTypes,
  });

  return { items, pageInfo: page.pageInfo };
});
