import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ref, onMounted } from 'vue';
import ValueEditor from './ValueEditor.vue';
import { QA_VALUE_EDITOR } from './valueEditor.config.js';
import { ARTICLE_CT } from '~/utils/queryBuilder/fixtures';
import { defaultOperator } from '~/utils/queryBuilder/operators';
import type { DraftFilter } from '~/utils/queryBuilder/machine';
import { ContainerDecorator } from '../../.storybook/decorators';

/** Build a draft for one of ARTICLE_CT's fields (op = the field's v1 default). */
function draftFor(identifier: string): DraftFilter {
  const field = ARTICLE_CT.fields.find((f) => f.identifier === identifier)!;
  return { field, op: defaultOperator(field.type).id, value: null };
}

const meta: Meta<typeof ValueEditor> = {
  title: 'Search/ValueEditor',
  component: ValueEditor,
  parameters: { layout: 'centered' },
  // The editor fills its parent (it normally sits in the dropdown's value slot).
  decorators: [ContainerDecorator(360)],
  args: {
    text: '',
    onSetValue: fn(),
    onCommit: fn(),
    onChooseEntry: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof ValueEditor>;

// BOOLEAN — True / False rows; picking one emits setValue(<bool>) + commit.
export const BooleanValue: Story = {
  args: { draft: draftFor('featured') },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId(QA_VALUE_EDITOR.OPTION(0))
    ).toHaveTextContent('True');
    await expect(
      canvas.getByTestId(QA_VALUE_EDITOR.OPTION(1))
    ).toHaveTextContent('False');
    await userEvent.click(canvas.getByTestId(QA_VALUE_EDITOR.OPTION(0))); // True
    // a real boolean is emitted, not the string label
    expect(args.onSetValue).toHaveBeenLastCalledWith(true);
    expect(args.onCommit).toHaveBeenCalled();
  },
};

// SELECT — one row per choice (Draft / Active / Ended).
export const SelectValue: Story = {
  args: { draft: draftFor('status') },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId(QA_VALUE_EDITOR.OPTION(0))
    ).toHaveTextContent('Draft');
    await userEvent.click(canvas.getByTestId(QA_VALUE_EDITOR.OPTION(1))); // Active
    expect(args.onSetValue).toHaveBeenLastCalledWith('Active');
    expect(args.onCommit).toHaveBeenCalled();
  },
};

// RELATION — async entry search. ValueEditor only searches when `text` changes,
// so the harness nudges it after mount to populate results.
export const EntryValue: Story = {
  args: {
    draft: draftFor('author'),
    searchEntries: fn(async () => [
      { id: 'e1', entryTitle: 'Jamie Rivera', contentTypeName: 'Author' },
      { id: 'e2', entryTitle: 'Sam Okafor', contentTypeName: 'Author' },
    ]),
  },
  render: (args) => ({
    components: { ValueEditor },
    setup() {
      const text = ref('');
      onMounted(() => {
        text.value = 'ja';
      });
      return { args, text };
    },
    template: `<ValueEditor v-bind="args" :text="text" />`,
  }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    expect(args.searchEntries).toHaveBeenCalledWith(['au1'], 'ja');
    const first = await canvas.findByTestId(QA_VALUE_EDITOR.OPTION(0));
    await expect(first).toHaveTextContent('Jamie Rivera');
    await userEvent.click(first);
    expect(args.onChooseEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'e1', entryTitle: 'Jamie Rivera' })
    );
  },
};

// TEXT / NUMBER / DATETIME — no rows, just the "type a value, then →" hint.
export const TextHint: Story = {
  args: { draft: draftFor('summary') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const hint = canvas.getByTestId(QA_VALUE_EDITOR.HINT);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveTextContent(/Type a value/);
  },
};
