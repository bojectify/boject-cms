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

export const KeyboardActivation: Story = {
  args: {
    value: { contentTypeId: 'ct-author', entryId: 'a1' },
    entryTitle: 'Ada Lovelace',
    contentTypeName: 'Author',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // The card body is a real <button> — focusable and keyboard-activatable.
    const card = await canvas.findByRole('button', { name: /Ada Lovelace/i });
    card.focus();
    expect(canvasElement.ownerDocument.activeElement).toBe(card);
    await userEvent.keyboard('{Enter}');
    expect(args.onEdit).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(' ');
    expect(args.onEdit).toHaveBeenCalledTimes(2);
  },
};

export const EmptyKeyboardActivation: Story = {
  args: {
    value: null,
    entryTitle: null,
    contentTypeName: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const addBtn = await canvas.findByRole('button', { name: /add entry/i });
    addBtn.focus();
    expect(canvasElement.ownerDocument.activeElement).toBe(addBtn);
    await userEvent.keyboard('{Enter}');
    expect(args.onAdd).toHaveBeenCalledTimes(1);
  },
};
