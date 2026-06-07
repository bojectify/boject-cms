import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import QueryBuilder from './QueryBuilder.vue';
import { CONTENT_TYPES } from '~/utils/queryBuilder/fixtures';

const meta: Meta<typeof QueryBuilder> = {
  title: 'Search/QueryBuilder',
  component: QueryBuilder,
  args: {
    contentTypes: CONTENT_TYPES,
    searchEntries: fn(async () => [
      { id: 'e1', entryTitle: 'Jamie Rivera', contentTypeName: 'Author' },
    ]),
    'onUpdate:modelValue': fn(),
    onRun: fn(),
    onBroaden: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof QueryBuilder>;

export const Initial: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByPlaceholderText(/search everything/i)
    ).toBeVisible();
  },
};

export const FreeTextTyped: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox'), 'art');
    // free-text action + matching content types appear
    await expect(canvas.getByText(/search for/i)).toBeVisible();
    await expect(canvas.getByText('Article')).toBeVisible();
    await userEvent.keyboard('{Enter}'); // runs free-text q
    await expect(args.onRun).toHaveBeenCalled();
  },
};

export const PickContentType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox'), 'art');
    await userEvent.click(canvas.getByText('Article'));
    // chip appears; dropdown now lists Article's fields
    await expect(canvas.getByText('Article')).toBeVisible();
    await expect(canvas.getByText('Summary')).toBeVisible();
    await expect(canvas.getByText('Status')).toBeVisible();
  },
};
