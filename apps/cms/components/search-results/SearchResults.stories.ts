import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import SearchResults from './SearchResults.vue';
import { QA_SEARCH_RESULTS } from './searchResults.config.js';
import { ContainerDecorator } from '../../.storybook/decorators';
import type { SearchQuery } from '~/utils/queryBuilder/types';

const QUERY: SearchQuery = {
  contentType: 'Article',
  q: 'goal',
  filters: [{ field: 'status', op: 'eq', value: 'Active' }],
};

const meta: Meta<typeof SearchResults> = {
  title: 'Search/SearchResults',
  component: SearchResults,
  decorators: [ContainerDecorator(800)],
  args: {
    query: QUERY,
    contentTypeName: 'Article',
    total: 1,
    page: 1,
    hits: [
      {
        id: 'e1',
        entryTitle: 'Cup final report',
        snippet: 'a late <em>goal</em> sealed it',
        publishedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    'onUpdate:page': fn(),
    onRemoveFilter: fn(),
    onEdit: fn(),
    onClear: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof SearchResults>;

export const Results: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId(QA_SEARCH_RESULTS.ROW(0));
    await expect(row).toHaveTextContent('Cup final report');
    await expect(row.querySelector('em')).toHaveTextContent('goal');
  },
};

export const EditAndClear: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId(QA_SEARCH_RESULTS.EDIT));
    await expect(args.onEdit).toHaveBeenCalled();
    await userEvent.click(canvas.getByTestId(QA_SEARCH_RESULTS.CLEAR));
    await expect(args.onClear).toHaveBeenCalled();
  },
};

export const NoResults: Story = {
  args: { hits: [], total: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId(QA_SEARCH_RESULTS.EMPTY)).toBeVisible();
  },
};

export const Unavailable: Story = {
  args: { unavailable: true, hits: [], total: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId(QA_SEARCH_RESULTS.UNAVAILABLE)
    ).toBeVisible();
  },
};
