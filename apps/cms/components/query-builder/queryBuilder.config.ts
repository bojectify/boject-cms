import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_QUERY_BUILDER = {
  ...testIds('QUERY_BUILDER', {
    INPUT: 'input',
    CONTENT_TYPE_CHIP: 'content-type-chip',
    DROPDOWN: 'dropdown',
    FOOTER: 'footer',
  }),
  FILTER_CHIP: testIdModifier('QUERY_BUILDER', 'filter-chip').index,
};
