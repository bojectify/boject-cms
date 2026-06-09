import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_QUERY_CHIPS = {
  ...testIds('QUERY_CHIPS', {
    CONTENT_TYPE_CHIP: 'content-type-chip',
  }),
  // Committed filter chips (indexed).
  FILTER_CHIP: testIdModifier('QUERY_CHIPS', 'filter-chip').index,
};
