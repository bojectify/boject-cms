import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import MultiRelationField from './MultiRelationField.vue';

const meta: Meta<typeof MultiRelationField> = {
  title: 'Components/MultiRelationField',
  component: MultiRelationField,
  tags: ['autodocs'],
  args: {
    onAdd: fn(),
    onEdit: fn(),
    onRemove: fn(),
    onReorder: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof MultiRelationField>;

export const Empty: Story = {
  args: {
    items: [],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const addBtn = await canvas.findByText(/add entry/i);
    await userEvent.click(addBtn);
    expect(args.onAdd).toHaveBeenCalledTimes(1);
  },
};

export const KeyboardAddEntry: Story = {
  args: {
    items: [],
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

export const WithItems: Story = {
  args: {
    items: [
      {
        contentTypeId: 'ct-tag',
        entryId: 't1',
        entryTitle: 'TypeScript',
        contentTypeName: 'Tag',
      },
      {
        contentTypeId: 'ct-tag',
        entryId: 't2',
        entryTitle: 'Vue',
        contentTypeName: 'Tag',
      },
      {
        contentTypeId: 'ct-tag',
        entryId: 't3',
        entryTitle: 'Storybook',
        contentTypeName: 'Tag',
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const firstCard = await canvas.findByText('TypeScript');
    await userEvent.click(firstCard);
    expect(args.onEdit).toHaveBeenCalledWith(0);
  },
};
