import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { BuilderState } from '~/utils/queryBuilder/machine';

export type QueryDropdownProps = BasicComponentProps & {
  state: BuilderState;
};
