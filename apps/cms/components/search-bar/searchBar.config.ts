import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_SEARCH_BAR = {
  ...testIds('SEARCH_BAR', {
    EDIT: 'edit',
    CLEAR: 'clear',
  }),
  // Filter chips in summary mode (indexed).
  FILTER_CHIP: testIdModifier('SEARCH_BAR', 'filter-chip').index,
};
