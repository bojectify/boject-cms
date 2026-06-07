import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import FilterChip from './FilterChip.vue';

const meta: Meta<typeof FilterChip> = {
  title: 'Search/FilterChip',
  component: FilterChip,
  args: {
    field: 'Summary',
    operator: 'contains',
    value: 'playoff',
    activeSegment: null,
    onRemove: fn(),
    onEditSegment: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof FilterChip>;

export const Locked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Summary')).toBeVisible();
    await expect(canvas.getByText('contains')).toBeVisible();
    await expect(canvas.getByText(/playoff/)).toBeVisible();
  },
};

export const ValueActive: Story = {
  args: { activeSegment: 'value' },
  play: async ({ canvasElement }) => {
    // active segment carries the focus-ring class
    const seg = canvasElement.querySelector('[data-segment="value"]')!;
    await expect(seg.className).toMatch(/ring/);
  },
};

export const RemoveButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: /remove filter/i })
    );
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};

export const EditSegment: Story = {
  play: async ({ canvasElement, args }) => {
    // clicking a segment emits editSegment with that segment's name
    const fieldSeg = canvasElement.querySelector<HTMLButtonElement>(
      '[data-segment="field"]'
    )!;
    await userEvent.click(fieldSeg);
    await expect(args.onEditSegment).toHaveBeenCalledWith('field');
  },
};
