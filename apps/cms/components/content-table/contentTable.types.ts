import type { TableColumn } from '@nuxt/ui';
import type { BasicComponentProps } from '~/types/basicComponentProps';

export type ContentTableProps = BasicComponentProps & {
  title: string;
  /** Optional muted line under the title (e.g. a search result count). */
  subtitle?: string;
  data: Record<string, unknown>[];
  loading?: boolean;
  columns?: TableColumn<Record<string, unknown>>[];
  page?: number;
  total?: number;
  itemsPerPage?: number;
  rowLink?: (_row: Record<string, unknown>) => string;
  /** Render a leading selection-checkbox column (search/editorial mode). */
  selectable?: boolean;
  /** Whether a row id is selected (from useRowSelection). */
  isSelected?: (_id: string) => boolean;
  /** Header checkbox state. */
  allSelected?: boolean;
  indeterminate?: boolean;
};
