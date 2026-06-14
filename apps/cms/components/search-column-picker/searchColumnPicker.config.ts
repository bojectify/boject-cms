import { testIds, testIdModifier } from '~/utils/test-config/testConfig.utils';

export const QA_SEARCH_COLUMN_PICKER = {
  ...testIds('SEARCH_COLUMN_PICKER', {
    TRIGGER: 'trigger',
    PANEL: 'panel',
  }),
  ROW: testIdModifier('SEARCH_COLUMN_PICKER', 'row'),
};
