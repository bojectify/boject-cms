import { testIdModifier, testIds } from '~/utils/test-config/testConfig.utils';

export const QA_QUERY_BUILDER = {
  ...testIds('QUERY_BUILDER', {
    INPUT: 'input',
    CONTENT_TYPE_CHIP: 'content-type-chip',
    DROPDOWN: 'dropdown',
    FOOTER: 'footer',
    // The in-progress draft chip (field + operator + the editable value input).
    DRAFT_CHIP: 'draft-chip',
    // The value-segment input inside the draft chip (the focus target after
    // picking a field).
    VALUE_INPUT: 'value-input',
  }),
  FILTER_CHIP: testIdModifier('QUERY_BUILDER', 'filter-chip').index,
};
