import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { BuilderState } from '~/utils/queryBuilder/machine';

export type QueryDropdownProps = BasicComponentProps & {
  state: BuilderState;
  /** Id of the currently keyboard-highlighted option (drives aria-selected + highlight). */
  activeId?: string | null;
};
