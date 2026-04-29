import type { PasswordRuleId } from '~/utils/validatePassword';
import type { BasicComponentProps } from '~/types/basicComponentProps';

export type PasswordRequirementsProps = BasicComponentProps & {
  /**
   * The list of rule ids that are currently failing. Each rule the panel
   * renders is satisfied iff its id is NOT in this array.
   */
  failures: PasswordRuleId[];
};
