import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_VALUE_EDITOR = {
  ...testIds('VALUE_EDITOR', {
    HINT: 'hint',
  }),
  // Selectable rows (boolean / select / entry). The branches are mutually
  // exclusive, so the index restarts per kind — OPTION(0) is the first row of
  // whichever editor is showing.
  OPTION: testIdModifier('VALUE_EDITOR', 'option').index,
};
