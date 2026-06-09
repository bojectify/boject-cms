import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import FilterChip from './FilterChip.vue';
import { QA_FILTER_CHIP } from './filterChip.config.js';

const meta: Meta<typeof FilterChip> = {
  title: 'Search/FilterChip',
  component: FilterChip,
  parameters: { layout: 'centered' },
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
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toBeVisible();
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Summary');
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.OPERATOR_SEGMENT)
    ).toBeVisible();
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.OPERATOR_SEGMENT)
    ).toHaveTextContent('contains');
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toBeVisible();
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('playoff');
  },
};

export const ValueActive: Story = {
  args: { activeSegment: 'value' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // active segment carries the focus-ring class
    const seg = canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT);
    await expect(seg.className).toMatch(/ring/);
  },
};

export const RemoveButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId(QA_FILTER_CHIP.REMOVE_BUTTON));
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};

export const EditSegment: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // clicking a segment emits editSegment with that segment's name
    const fieldSeg = canvas.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT);
    await userEvent.click(fieldSeg);
    await expect(args.onEditSegment).toHaveBeenCalledWith('field');
  },
};

// Draft mode: the value segment hosts a slotted input (the editable value) and
// the ✕ remove button is hidden (a draft is cancelled, not removed).
export const Editing: Story = {
  args: { value: null, activeSegment: 'value', showRemove: false },
  render: (args) => ({
    components: { FilterChip },
    setup: () => ({ args }),
    template: `
      <FilterChip v-bind="args">
        <template #value>
          <input data-testid="draft-value" value="playoff" />
        </template>
      </FilterChip>`,
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('draft-value')).toBeVisible();
    await expect(canvas.queryByTestId(QA_FILTER_CHIP.REMOVE_BUTTON)).toBeNull();
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Summary');
  },
};
