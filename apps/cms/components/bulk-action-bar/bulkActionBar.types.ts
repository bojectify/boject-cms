import type { BasicComponentProps } from '~/types/basicComponentProps';

export type BulkActionBarProps = BasicComponentProps & {
  count: number;
  busy?: boolean;
};
