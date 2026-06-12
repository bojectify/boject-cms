import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fireEvent, userEvent, within } from 'storybook/test';
import ContentTable from './ContentTable.vue';
import { useRowSelection } from '~/composables/useRowSelection';

const meta: Meta<typeof ContentTable> = {
  title: 'Components/ContentTable',
  component: ContentTable,
};
export default meta;
type Story = StoryObj<typeof ContentTable>;

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
