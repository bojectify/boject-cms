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

export const BooleanValue: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox'), 'art');
    await userEvent.click(canvas.getByText('Article'));
    await userEvent.click(canvas.getByText('Featured'));
    await userEvent.click(canvas.getByText('True')); // boolean value picked
    // chip committed: only the chip's value segment renders "true" (the
    // re-rendered field list behind it does not), so this proves the commit
    await expect(canvas.getByText('true')).toBeVisible();
    // and the emitted query carries the real boolean value, not the string
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [expect.objectContaining({ field: 'featured', value: true })],
      })
    );
  },
};

export const SelectValue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox'), 'art');
    await userEvent.click(canvas.getByText('Article'));
    await userEvent.click(canvas.getByText('Status'));
    await userEvent.click(canvas.getByText('Active'));
    await expect(canvas.getByText(/Active/)).toBeVisible();
  },
};

export const TextValueCommitsWithArrow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox'), 'art');
    await userEvent.click(canvas.getByText('Article'));
    await userEvent.click(canvas.getByText('Summary'));
    await userEvent.type(canvas.getByRole('combobox'), 'playoff');
    await userEvent.keyboard('{ArrowRight}'); // → commits the value
    await expect(canvas.getByText(/playoff/)).toBeVisible();
  },
};

export const RelationValue: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox'), 'art');
    await userEvent.click(canvas.getByText('Article'));
    await userEvent.click(canvas.getByText('Author'));
    await userEvent.type(canvas.getByRole('combobox'), 'ja');
    expect(args.searchEntries).toHaveBeenCalledWith(['au1'], 'ja');
    await userEvent.click(await canvas.findByText('Jamie Rivera'));
    await expect(canvas.getByText(/Jamie Rivera/)).toBeVisible();
  },
};
