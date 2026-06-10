import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import MultiSelectEditor from './MultiSelectEditor.vue';
import { QA_MULTI_SELECT_EDITOR } from './multiSelectEditor.config.js';

const meta: Meta<typeof MultiSelectEditor> = {
  title: 'Search/MultiSelectEditor',
  component: MultiSelectEditor,
  args: {
    draft: {
      field: {
        identifier: 'status',
        name: 'Status',
        type: 'SELECT',
        choices: [
          { label: 'Draft', value: 'draft' },
          { label: 'Active', value: 'active' },
          { label: 'Ended', value: 'ended' },
        ],
      },
      op: 'in',
      value: ['active'],
    },
    onToggle: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof MultiSelectEditor>;

export const TogglesAChoice: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // 'active' (index 1) is pre-selected → aria-selected true
    await expect(
      canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(1))
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(0))
    ).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(2))); // Ended
    expect(args.onToggle).toHaveBeenLastCalledWith('ended');
  },
};
