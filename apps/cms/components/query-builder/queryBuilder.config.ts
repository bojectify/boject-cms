import { testIds } from '~/utils/test-config/testConfig.utils';

export const QA_QUERY_BUILDER = {
  ...testIds('QUERY_BUILDER', {
    INPUT: 'input',
    DROPDOWN: 'dropdown',
    FOOTER: 'footer',
    // The right-edge "Search" submit button (commit pending value + run).
    SUBMIT: 'submit',
    // The top search/chip row (content-type + filter chips + input). Wraps onto
    // multiple lines as chips accumulate.
    CHIP_ROW: 'chip-row',
    // The in-progress draft chip (field + operator + the editable value input).
    DRAFT_CHIP: 'draft-chip',
    // The value-segment input inside the draft chip (the focus target after
    // picking a field).
    VALUE_INPUT: 'value-input',
  }),
};
