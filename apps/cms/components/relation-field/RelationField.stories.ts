import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import RelationField from './RelationField.vue';

const meta: Meta<typeof RelationField> = {
  title: 'Components/RelationField',
  component: RelationField,
  tags: ['autodocs'],
  args: {
    onAdd: fn(),
    onEdit: fn(),
    onRemove: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof RelationField>;

export const Empty: Story = {
  args: {
    label: 'Author',
    required: false,
    value: null,
    entryTitle: null,
    contentTypeName: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const addBtn = await canvas.findByText(/add entry/i);
    await userEvent.click(addBtn);
    expect(args.onAdd).toHaveBeenCalledTimes(1);
  },
};

export const Filled: Story = {
  args: {
    label: 'Author',
    required: false,
    value: { contentTypeId: 'ct-author', entryId: 'a1' },
    entryTitle: 'Ada Lovelace',
    contentTypeName: 'Author',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByText('Ada Lovelace');
    await userEvent.click(card);
    expect(args.onEdit).toHaveBeenCalledTimes(1);
  },
};
