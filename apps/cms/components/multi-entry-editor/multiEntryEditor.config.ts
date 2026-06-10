import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_MULTI_ENTRY_EDITOR = {
  ...testIds('MULTI_ENTRY_EDITOR', {}),
  // Selectable entry rows; the index restarts per render — OPTION(0) is the
  // first entry. aria-selected reflects the checkbox state, not the highlight.
  OPTION: testIdModifier('MULTI_ENTRY_EDITOR', 'option').index,
};
