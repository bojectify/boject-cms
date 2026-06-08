import type { BasicComponentProps } from '~/types/basicComponentProps';

export type ChipSegment = 'field' | 'operator' | 'value';

export type FilterChipProps = BasicComponentProps & {
  field: string;
  operator: string;
  value?: string | null;
  /** Which segment shows the focus ring. */
  activeSegment?: ChipSegment | null;
};
