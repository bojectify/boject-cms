import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import { EditorView } from '@codemirror/view';
import JsonField from './JsonField.vue';
import { QA_JSON_FIELD } from './jsonField.config.js';

const meta: Meta<typeof JsonField> = {
  title: 'Fields/JsonField',
  component: JsonField,
  parameters: { layout: 'padded' },
  args: {
    label: 'Key',
    'onUpdate:modelValue': fn(),
    'onUpdate:error': fn(),
  },
};
export default meta;
type Story = StoryObj<typeof JsonField>;

/** The mounted CodeMirror view inside the component. */
async function getView(canvasElement: HTMLElement): Promise<EditorView> {
  const canvas = within(canvasElement);
  const host = await canvas.findByTestId(QA_JSON_FIELD.EDITOR);
  const content = await waitFor(() => {
    const el = host.querySelector<HTMLElement>('.cm-content');
    if (!el) throw new Error('editor not mounted');
    return el;
  });
  return EditorView.findFromDOM(content)!;
}

/** Replace the whole document, as a user select-all + type would. */
function replaceText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}

// A stored value renders pretty-printed with a 2-space indent.
export const Prefilled: Story = {
  args: { modelValue: { c: 'd', b: 'e' } },
  play: async ({ canvasElement }) => {
    const view = await getView(canvasElement);
    expect(view.state.doc.toString()).toBe('{\n  "c": "d",\n  "b": "e"\n}');
  },
};

// Valid JSON emits the parsed value and clears the error.
export const ValidEdit: Story = {
  args: { modelValue: { b: 'e' } },
  play: async ({ canvasElement, args }) => {
    const view = await getView(canvasElement);
    replaceText(view, '{"x":[1]}');
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith({ x: [1] });
    expect(args['onUpdate:error']).toHaveBeenLastCalledWith(null);
  },
};

// Unparseable text shows an inline error and emits it; the value is untouched.
export const ParseError: Story = {
  args: { modelValue: { b: 'e' } },
  play: async ({ canvasElement, args }) => {
    const view = await getView(canvasElement);
    replaceText(view, '{"x":');
    const canvas = within(canvasElement);
    const error = await canvas.findByTestId(QA_JSON_FIELD.ERROR);
    expect(error.textContent).toMatch(/^Invalid JSON/);
    expect(args['onUpdate:error']).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Invalid JSON/)
    );
    expect(args['onUpdate:modelValue']).not.toHaveBeenCalled();
  },
};

// A top-level scalar parses but breaks the object/array rule.
export const TopLevelScalar: Story = {
  args: { modelValue: { b: 'e' } },
  play: async ({ canvasElement, args }) => {
    const view = await getView(canvasElement);
    replaceText(view, '"hello"');
    const canvas = within(canvasElement);
    const error = await canvas.findByTestId(QA_JSON_FIELD.ERROR);
    expect(error.textContent).toBe('Value must be a JSON object or array');
    expect(args['onUpdate:error']).toHaveBeenLastCalledWith(
      'Value must be a JSON object or array'
    );
    expect(args['onUpdate:modelValue']).not.toHaveBeenCalled();
  },
};

// Clearing all text means "no value": emits null and no error.
export const Cleared: Story = {
  args: { modelValue: { b: 'e' }, required: true },
  play: async ({ canvasElement, args }) => {
    const view = await getView(canvasElement);
    replaceText(view, '   ');
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith(null);
    expect(args['onUpdate:error']).toHaveBeenLastCalledWith(null);
    const canvas = within(canvasElement);
    expect(canvas.queryByTestId(QA_JSON_FIELD.ERROR)).toBeNull();
  },
};
