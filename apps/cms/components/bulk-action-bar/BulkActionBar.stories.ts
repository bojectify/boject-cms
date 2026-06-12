import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import BulkActionBar from './BulkActionBar.vue';
import { QA_BULK_ACTION_BAR } from './bulkActionBar.config.js';

const meta: Meta<typeof BulkActionBar> = {
  title: 'Content/BulkActionBar',
  component: BulkActionBar,
  parameters: { layout: 'centered' },
  args: {
    count: 3,
    onPublish: fn(),
    onClear: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof BulkActionBar>;

// With a selection, the bar floats in, shows the count, and the Publish / Clear
// buttons emit their events to the host page (which owns the actual mutation).
export const WithSelection: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const bar = canvas.getByTestId(QA_BULK_ACTION_BAR.COMPONENT);
    await expect(bar).toBeVisible();
    await expect(
      canvas.getByTestId(QA_BULK_ACTION_BAR.COUNT)
    ).toHaveTextContent('3 selected');

    await userEvent.click(
      canvas.getByTestId(QA_BULK_ACTION_BAR.PUBLISH_BUTTON)
    );
    await expect(args.onPublish).toHaveBeenCalledTimes(1);

    await userEvent.click(canvas.getByTestId(QA_BULK_ACTION_BAR.CLEAR_BUTTON));
    await expect(args.onClear).toHaveBeenCalledTimes(1);
  },
};

// No selection: the bar is unmounted entirely (so selecting never shifts rows).
export const NoSelection: Story = {
  args: { count: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId(QA_BULK_ACTION_BAR.COMPONENT)).toBeNull();
  },
};

// Busy: Publish shows a spinner and Clear is disabled while the page mutates.
export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId(QA_BULK_ACTION_BAR.PUBLISH_BUTTON)
    ).toBeDisabled();
    await expect(
      canvas.getByTestId(QA_BULK_ACTION_BAR.CLEAR_BUTTON)
    ).toBeDisabled();
  },
};
