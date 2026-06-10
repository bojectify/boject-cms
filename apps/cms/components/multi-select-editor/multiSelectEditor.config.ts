import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_MULTI_SELECT_EDITOR = {
  ...testIds('MULTI_SELECT_EDITOR', {}),
  // Selectable choice rows; the index restarts per render — OPTION(0) is the
  // first choice. aria-selected reflects the checkbox state, not the highlight.
  OPTION: testIdModifier('MULTI_SELECT_EDITOR', 'option').index,
};
