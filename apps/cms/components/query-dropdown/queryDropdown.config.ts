import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_QUERY_DROPDOWN = {
  ...testIds('QUERY_DROPDOWN', {
    FREE_TEXT_ACTION: 'free-text-action',
  }),
  OPTION: testIdModifier('QUERY_DROPDOWN', 'option').index,
};
