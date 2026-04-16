import type { TableColumn } from '@nuxt/ui';
import type { BasicComponentProps } from '~/types/basicComponentProps';

export type ContentTableProps = BasicComponentProps & {
  title: string;
  data: Record<string, unknown>[];
  loading?: boolean;
  columns?: TableColumn<Record<string, unknown>>[];
  page?: number;
  total?: number;
  itemsPerPage?: number;
  rowLink?: (_row: Record<string, unknown>) => string;
};
