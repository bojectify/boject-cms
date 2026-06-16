import type { BasicComponentProps } from '~/types/basicComponentProps';

export type BooleanTriStateProps = BasicComponentProps & {
  /** Current value. `undefined` is the "None" (unset) state. */
  modelValue?: boolean;
  /**
   * When true, the "None" segment is rendered but disabled — used for required
   * fields, where an unset value is not a legal choice (#344).
   */
  disableNone?: boolean;
};
