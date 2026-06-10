import { testIds, testIdModifier } from '~/utils/test-config/testConfig.utils';

export const QA_DATE_RANGE_EDITOR = {
  ...testIds('DATE_RANGE_EDITOR', {}),
  // Preset quick-range buttons, keyed by PresetId, e.g. PRESET('last7').
  PRESET: testIdModifier('DATE_RANGE_EDITOR', 'preset').id,
};
