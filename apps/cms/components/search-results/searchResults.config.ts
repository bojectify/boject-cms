import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_SEARCH_RESULTS = {
  ...testIds('SEARCH_RESULTS', {
    SUMMARY_BAR: 'summary-bar',
    EDIT: 'edit',
    CLEAR: 'clear',
    TABLE: 'table',
    EMPTY: 'empty',
    UNAVAILABLE: 'unavailable',
    LOADING: 'loading',
  }),
  ROW: testIdModifier('SEARCH_RESULTS', 'row').index,
};
