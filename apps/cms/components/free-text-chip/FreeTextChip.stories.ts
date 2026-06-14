import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import FreeTextChip from './FreeTextChip.vue';
import { QA_FREE_TEXT_CHIP } from './freeTextChip.config.js';

const meta: Meta<typeof FreeTextChip> = {
  title: 'Search/FreeTextChip',
  component: FreeTextChip,
  parameters: { layout: 'centered' },
  args: {
    value: 'dave',
    onEdit: fn(),
    onRemove: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof FreeTextChip>;

export const RendersValue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId(QA_FREE_TEXT_CHIP.EDIT_BUTTON)
    ).toHaveTextContent('dave');
  },
};

export const ClickEditsTheTerm: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId(QA_FREE_TEXT_CHIP.EDIT_BUTTON));
    await expect(args.onEdit).toHaveBeenCalledTimes(1);
  },
};

export const RemoveButtonEmitsRemove: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId(QA_FREE_TEXT_CHIP.REMOVE_BUTTON));
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};
