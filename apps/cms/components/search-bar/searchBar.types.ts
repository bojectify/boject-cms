import type { BasicComponentProps } from '~/types/basicComponentProps';

export type SearchBarProps = BasicComponentProps & {
  /** Placeholder text, scoped to the surface (e.g. "Search Articles…"). */
  placeholder?: string;
};
