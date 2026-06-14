import type { BasicComponentProps } from '~/types/basicComponentProps';

export type FreeTextChipProps = BasicComponentProps & {
  /** The committed free-text query (`query.q`), rendered quoted. */
  value: string;
};
