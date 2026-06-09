import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_VALUE_EDITOR = {
  ...testIds('VALUE_EDITOR', {
    HINT: 'hint',
    // The "Add filter — <field> <op> '<value>'" confirm row for free-entry
    // (text / number / datetime) values; clicking it commits the typed value.
    CONFIRM: 'confirm',
  }),
  // Selectable rows (boolean / select / entry). The branches are mutually
  // exclusive, so the index restarts per kind — OPTION(0) is the first row of
  // whichever editor is showing.
  OPTION: testIdModifier('VALUE_EDITOR', 'option').index,
};
