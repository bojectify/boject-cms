import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, within } from 'storybook/test';
import SearchFieldCell from './SearchFieldCell.vue';
import { QA_SEARCH_FIELD_CELL } from './searchFieldCell.config.js';
import { FIELD_TYPES } from '~/utils/fieldTypes';

const meta: Meta<typeof SearchFieldCell> = {
  title: 'Search/SearchFieldCell',
  component: SearchFieldCell,
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof SearchFieldCell>;

export const Relation: Story = {
  args: {
    value: { entryId: 'a', entryTitle: 'Acme Corp' },
    fieldType: FIELD_TYPES.RELATION,
  },
  play: async ({ canvasElement }) => {
    const cell = within(canvasElement).getByTestId(
      QA_SEARCH_FIELD_CELL.COMPONENT
    );
    await expect(cell).toHaveTextContent('Acme Corp');
  },
};

export const EmptyMultirelation: Story = {
  args: { value: [], fieldType: FIELD_TYPES.MULTIRELATION },
  play: async ({ canvasElement }) => {
    const cell = within(canvasElement).getByTestId(
      QA_SEARCH_FIELD_CELL.COMPONENT
    );
    await expect(cell).toHaveTextContent('—');
  },
};

export const Number: Story = {
  args: { value: 42, fieldType: FIELD_TYPES.NUMBER },
  play: async ({ canvasElement }) => {
    const cell = within(canvasElement).getByTestId(
      QA_SEARCH_FIELD_CELL.COMPONENT
    );
    await expect(cell).toHaveTextContent('42');
  },
};

export const LongTextTooltip: Story = {
  args: {
    value:
      'a very long text value that should be truncated visually but exposed in full via the title attribute',
    fieldType: FIELD_TYPES.TEXT,
  },
  play: async ({ canvasElement }) => {
    const cell = within(canvasElement).getByTestId(
      QA_SEARCH_FIELD_CELL.COMPONENT
    );
    await expect(cell).toHaveAttribute(
      'title',
      'a very long text value that should be truncated visually but exposed in full via the title attribute'
    );
  },
};
