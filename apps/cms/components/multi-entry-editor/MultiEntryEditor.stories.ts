import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import MultiEntryEditor from './MultiEntryEditor.vue';
import { QA_MULTI_ENTRY_EDITOR } from './multiEntryEditor.config.js';

const meta: Meta<typeof MultiEntryEditor> = {
  title: 'Search/MultiEntryEditor',
  component: MultiEntryEditor,
  args: {
    draft: {
      field: {
        identifier: 'tags',
        name: 'Tags',
        type: 'MULTIRELATION',
        targetContentTypeIds: ['t1'],
      },
      op: 'containsAny',
      value: ['e1'],
    },
    text: '',
    searchEntries: fn(async () => [
      { id: 'e1', entryTitle: 'News', contentTypeName: 'Tag' },
      { id: 'e2', entryTitle: 'Sport', contentTypeName: 'Tag' },
    ]),
    onToggle: fn(),
    onCaptureLabel: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof MultiEntryEditor>;

export const TogglesAnEntry: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // e1 (News) pre-selected → aria-selected true (await: entries load async)
    await expect(
      await canvas.findByTestId(QA_MULTI_ENTRY_EDITOR.OPTION(0))
    ).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(canvas.getByTestId(QA_MULTI_ENTRY_EDITOR.OPTION(1))); // Sport
    expect(args.onToggle).toHaveBeenLastCalledWith('e2');
    expect(args.onCaptureLabel).toHaveBeenLastCalledWith({
      id: 'e2',
      title: 'Sport',
    });
  },
};
