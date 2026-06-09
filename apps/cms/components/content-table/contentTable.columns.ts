import type { TableColumn } from '@nuxt/ui';

/**
 * The default browse columns. Pages pass their own `columns` to ContentTable to
 * replace this set (e.g. search results render Entry Title / Type / Published).
 */
export const DEFAULT_CONTENT_COLUMNS: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'entryTitle', header: 'Entry Title' },
  { accessorKey: 'createdAt', header: 'Created' },
  { accessorKey: 'updatedAt', header: 'Updated' },
  { accessorKey: 'status', header: 'Status' },
];
