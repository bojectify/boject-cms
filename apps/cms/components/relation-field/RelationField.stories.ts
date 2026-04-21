import type { Meta, StoryObj } from '@storybook/vue3-vite';
import RelationField from './RelationField.vue';

const meta: Meta<typeof RelationField> = {
  title: 'Components/RelationField',
  component: RelationField,
  tags: ['autodocs'],
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
};

export const Filled: Story = {
  args: {
    label: 'Author',
    required: false,
    value: { contentTypeId: 'ct-author', entryId: 'a1' },
    entryTitle: 'Ada Lovelace',
    contentTypeName: 'Author',
  },
};
