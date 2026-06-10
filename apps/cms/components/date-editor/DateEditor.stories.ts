import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import DateEditor from './DateEditor.vue';
import type { DraftFilter } from '~/utils/queryBuilder/machine';

const draft: DraftFilter = {
  field: { identifier: 'published', name: 'Published', type: 'DATETIME' },
  op: 'before',
  // seed June 2026 so the calendar opens on a known month (deterministic)
  value: '2026-06-15T00:00:00.000Z',
};

const meta: Meta<typeof DateEditor> = {
  title: 'Search/DateEditor',
  component: DateEditor,
  args: { draft, onSetValue: fn(), onCommit: fn() },
};
export default meta;
type Story = StoryObj<typeof DateEditor>;

// Picking a day emits the UTC start-of-day ISO (op `before`) + commits.
export const PickDayBefore: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // reka-ui renders each day cell as a button whose accessible name is the
    // full formatted date. Match June 8 (partial-name regex tolerates the weekday).
    const cell = await canvas.findByRole('button', { name: /June 8/ });
    await userEvent.click(cell);
    expect(args.onSetValue).toHaveBeenLastCalledWith(
      '2026-06-08T00:00:00.000Z'
    );
    expect(args.onCommit).toHaveBeenCalled();
  },
};

// `after` emits the end-of-day ISO instead.
export const PickDayAfter: Story = {
  args: { draft: { ...draft, op: 'after' } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const cell = await canvas.findByRole('button', { name: /June 8/ });
    await userEvent.click(cell);
    expect(args.onSetValue).toHaveBeenLastCalledWith(
      '2026-06-08T23:59:59.999Z'
    );
  },
};
