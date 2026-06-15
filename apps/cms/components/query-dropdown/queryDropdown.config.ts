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

export const TW_QUERY_DROPDOWN = {
  BUTTON:
    'flex shrink-0 items-center justify-between h-11 px-3 rounded-lg text-left hover:bg-elevated',
  ICON_BOX:
    'flex items-center justify-center shrink-0 size-7 rounded-md border border-default bg-default',
  PILL: 'shrink-0 rounded border border-default bg-default px-2 py-0.5 text-[11px] font-medium text-muted uppercase',
};
