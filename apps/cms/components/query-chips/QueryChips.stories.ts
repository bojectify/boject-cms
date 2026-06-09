import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import QueryChips from './QueryChips.vue';
import { QA_QUERY_CHIPS } from './queryChips.config.js';
import { QA_FILTER_CHIP } from '../filter-chip/filterChip.config.js';
import { QA_CONTENT_TYPE_CHIP } from '../content-type-chip/contentTypeChip.config.js';
import { ARTICLE_CT } from '~/utils/queryBuilder/fixtures';

const meta: Meta<typeof QueryChips> = {
  title: 'Search/QueryChips',
  component: QueryChips,
  parameters: { layout: 'centered' },
  // QueryChips is a fragment; wrap it in the flex row its consumers provide.
  decorators: [
    () => ({
      template: '<div class="flex items-center gap-2"><story /></div>',
    }),
  ],
  args: {
    contentTypeName: 'Article',
    fields: ARTICLE_CT.fields,
    filters: [
      { field: 'status', op: 'eq', value: 'Active' },
      { field: 'summary', op: 'eq', value: 'goal' },
    ],
    onRemoveContentType: fn(),
    onRemoveFilter: fn(),
    onEditSegment: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof QueryChips>;

// Content-type chip + committed filter chips render with display labels (not raw ids).
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId(QA_QUERY_CHIPS.CONTENT_TYPE_CHIP)
    ).toHaveTextContent('Article');
    const chip0 = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await expect(
      chip0.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Status');
    await expect(
      chip0.getByTestId(QA_FILTER_CHIP.OPERATOR_SEGMENT)
    ).toHaveTextContent('is');
    await expect(
      chip0.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('Active');
    const chip1 = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(1)));
    await expect(
      chip1.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Summary');
    await expect(
      chip1.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('goal');
  },
};

// Each interactive affordance emits the right event + payload.
export const Emits: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const chip0 = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await userEvent.click(chip0.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT));
    expect(args.onEditSegment).toHaveBeenLastCalledWith(0, 'field');
    await userEvent.click(chip0.getByTestId(QA_FILTER_CHIP.REMOVE_BUTTON));
    expect(args.onRemoveFilter).toHaveBeenLastCalledWith(0);
    const ctChip = within(canvas.getByTestId(QA_QUERY_CHIPS.CONTENT_TYPE_CHIP));
    await userEvent.click(
      ctChip.getByTestId(QA_CONTENT_TYPE_CHIP.REMOVE_BUTTON)
    );
    expect(args.onRemoveContentType).toHaveBeenCalled();
  },
};

// editingIndex hides exactly that committed chip (consumer renders it as a draft).
export const HidesEditingIndex: Story = {
  args: { editingIndex: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0))
    ).toBeNull();
    await expect(
      canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(1))
    ).toBeVisible();
  },
};

// A relation value resolves to the captured title via relationLabels (stages #322).
export const RelationLabelResolved: Story = {
  args: {
    filters: [{ field: 'author', op: 'eq', value: 'e1' }],
    relationLabels: { e1: 'Jamie Rivera' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Author');
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('Jamie Rivera');
  },
};

// Without a label, the relation chip degrades to the raw id.
export const RelationLabelMissingFallsBackToId: Story = {
  args: {
    filters: [{ field: 'author', op: 'eq', value: 'e1' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('e1');
  },
};
