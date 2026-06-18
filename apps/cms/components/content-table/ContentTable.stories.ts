import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fireEvent, fn, userEvent, within } from 'storybook/test';
import ContentTable from './ContentTable.vue';
import { QA_CONTENT_TABLE } from './contentTable.config';
import { useRowSelection } from '~/composables/useRowSelection';

const meta: Meta<typeof ContentTable> = {
  title: 'Components/ContentTable',
  component: ContentTable,
  args: {
    onNext: fn(),
    onPrev: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof ContentTable>;
type PlayContext = Parameters<NonNullable<Story['play']>>[0];

// Wire a real useRowSelection over four rows so the controlled checkbox state
// (the `:model-value` bound from `isSelected`) reflects the composable — the
// story asserts checked-ness, proving the click → toggle → controlled-value
// loop end-to-end (click, shift+click range, select-all).
export const Selectable: Story = {
  render: () => ({
    components: { ContentTable },
    setup() {
      const data = [
        { id: 'a', entryTitle: 'A' },
        { id: 'b', entryTitle: 'B' },
        { id: 'c', entryTitle: 'C' },
        { id: 'd', entryTitle: 'D' },
      ];
      const columns = [{ accessorKey: 'entryTitle', header: 'Title' }];
      const sel = useRowSelection(() => data);
      return { data, columns, sel };
    },
    template: `
      <ContentTable
        title="Entries"
        :data="data"
        :columns="columns"
        selectable
        :is-selected="sel.isSelected"
        :all-selected="sel.allSelected.value"
        :indeterminate="sel.indeterminate.value"
        @row-select="(e, id, i) => sel.toggle(id, i, e.shiftKey)"
        @select-all="sel.toggleAll"
      />`,
  }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    // index 0 = header select-all, 1.. = rows (A, B, C, D)
    const checkboxes = canvas.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(5);

    // Click row B (index 2) → only B selected
    await userEvent.click(checkboxes[2]!);
    expect(checkboxes[2]!).toBeChecked();
    expect(checkboxes[1]!).not.toBeChecked();
    expect(checkboxes[3]!).not.toBeChecked();

    // Shift-click row D (index 4) → range B..D turns ON (B, C, D)
    await fireEvent.click(checkboxes[4]!, { shiftKey: true });
    expect(checkboxes[2]!).toBeChecked(); // B
    expect(checkboxes[3]!).toBeChecked(); // C
    expect(checkboxes[4]!).toBeChecked(); // D

    // Click the header checkbox (index 0) → all four rows selected
    await userEvent.click(checkboxes[0]!);
    expect(checkboxes[1]!).toBeChecked();
    expect(checkboxes[2]!).toBeChecked();
    expect(checkboxes[3]!).toBeChecked();
    expect(checkboxes[4]!).toBeChecked();
  },
};

// Cursor (prev/next) mode: when `pageInfo` is set, ContentTable renders the
// prev/next block instead of the offset UPagination. Asserts disabled states
// driven by hasPreviousPage/hasNextPage and that clicking Next emits `next`.
export const CursorPagination: Story = {
  args: {
    title: 'Cursor',
    data: [{ id: '1', entryTitle: 'One' }],
    pageInfo: { hasNextPage: true, hasPreviousPage: false },
  },
  play: async ({ canvasElement, args }: PlayContext) => {
    const canvas = within(canvasElement);
    const next = await canvas.findByTestId(QA_CONTENT_TABLE.NEXT);
    const prev = await canvas.findByTestId(QA_CONTENT_TABLE.PREV);
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
    await userEvent.click(next);
    await expect(args.onNext).toHaveBeenCalled();
  },
};
