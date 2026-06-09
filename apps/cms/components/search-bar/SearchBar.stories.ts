import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import SearchBar from './SearchBar.vue';
import { QA_SEARCH_BAR } from './searchBar.config.js';
import { QA_FILTER_CHIP } from '../filter-chip/filterChip.config.js';
import { ARTICLE_CT } from '~/utils/queryBuilder/fixtures';
import { ContainerDecorator } from '../../.storybook/decorators';

const meta: Meta<typeof SearchBar> = {
  title: 'Search/SearchBar',
  component: SearchBar,
  parameters: { layout: 'centered' },
  // The bar fills its container (the page owns the width); bound it in isolation.
  decorators: [ContainerDecorator(700)],
  args: {
    placeholder: 'Search all content…',
    onOpen: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof SearchBar>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const bar = canvas.getByTestId(QA_SEARCH_BAR.COMPONENT);
    await expect(bar).toHaveTextContent('Search all content…');
    // clicking the launcher asks the host to open the palette
    await userEvent.click(bar);
    expect(args.onOpen).toHaveBeenCalledTimes(1);
  },
};

// Summary mode: read-only active query — content-type chip + filter chips (with
// display labels) + free text + Edit/Clear.
export const Summary: Story = {
  args: {
    query: {
      contentType: 'Article',
      q: 'playoff',
      filters: [{ field: 'status', op: 'eq', value: 'Active' }],
    },
    contentTypeName: 'Article',
    fields: ARTICLE_CT.fields,
    onEdit: fn(),
    onClear: fn(),
    onRemoveFilter: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const bar = canvas.getByTestId(QA_SEARCH_BAR.COMPONENT);
    await expect(bar).toHaveTextContent('Article');
    await expect(bar).toHaveTextContent('playoff');
    // the chip renders display labels (Status / is / Active), not raw ids
    const chip = within(canvas.getByTestId(QA_SEARCH_BAR.FILTER_CHIP(0)));
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Status');
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.OPERATOR_SEGMENT)
    ).toHaveTextContent('is');
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('Active');
    // remove a filter / edit / clear
    await userEvent.click(chip.getByTestId(QA_FILTER_CHIP.REMOVE_BUTTON));
    expect(args.onRemoveFilter).toHaveBeenLastCalledWith(0);
    await userEvent.click(canvas.getByTestId(QA_SEARCH_BAR.EDIT));
    expect(args.onEdit).toHaveBeenCalled();
    await userEvent.click(canvas.getByTestId(QA_SEARCH_BAR.CLEAR));
    expect(args.onClear).toHaveBeenCalled();
  },
};
