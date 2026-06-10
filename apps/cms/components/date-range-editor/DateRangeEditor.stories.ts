import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import DateRangeEditor from './DateRangeEditor.vue';
import { QA_DATE_RANGE_EDITOR } from './dateRangeEditor.config.js';
import type { DraftFilter } from '~/utils/queryBuilder/machine';

const draft: DraftFilter = {
  field: { identifier: 'published', name: 'Published', type: 'DATETIME' },
  op: 'between',
  value: null,
};

const meta: Meta<typeof DateRangeEditor> = {
  title: 'Search/DateRangeEditor',
  component: DateRangeEditor,
  args: { draft, onSetValue: fn(), onCommit: fn() },
};
export default meta;
type Story = StoryObj<typeof DateRangeEditor>;

// Clicking a preset emits a [startIso, endIso] pair + commits (deterministic path).
export const PresetCommitsRange: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByTestId(QA_DATE_RANGE_EDITOR.PRESET('last7'))
    );
    expect(args.onCommit).toHaveBeenCalled();
    const lastValue = (args.onSetValue as ReturnType<typeof fn>).mock.calls.at(
      -1
    )![0] as string[];
    expect(lastValue).toHaveLength(2);
    expect(lastValue[0]).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    expect(lastValue[1]).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/);
  },
};

// Selecting a start then an end day in the calendar commits the picked range.
export const CustomRangeCommits: Story = {
  args: {
    draft: {
      ...draft,
      value: ['2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.999Z'],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // seeded to June 2026; pick a fresh start (8th) then end (12th)
    await userEvent.click(
      await canvas.findByRole('button', { name: /June 8/ })
    );
    await userEvent.click(
      await canvas.findByRole('button', { name: /June 12/ })
    );
    const lastValue = (args.onSetValue as ReturnType<typeof fn>).mock.calls.at(
      -1
    )![0] as string[];
    expect(lastValue[0]).toBe('2026-06-08T00:00:00.000Z');
    expect(lastValue[1]).toBe('2026-06-12T23:59:59.999Z');
  },
};
