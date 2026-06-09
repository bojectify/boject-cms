import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

/** DOM id of the dropdown's `role="listbox"` element — the input's aria-controls
 * target and the root the roving keyboard nav queries for `[role="option"]`. */
export const QUERY_LISTBOX_ID = 'qb-query-listbox';

export const QA_QUERY_DROPDOWN = {
  ...testIds('QUERY_DROPDOWN', {
    FREE_TEXT_ACTION: 'free-text-action',
  }),
  OPTION: testIdModifier('QUERY_DROPDOWN', 'option').index,
};
