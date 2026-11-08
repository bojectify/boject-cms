import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { EditorView } from '@codemirror/view';
import { ref } from 'vue';
import ContentEditor from './ContentEditor.vue';
import { QA_JSON_FIELD } from '../json-field/jsonField.config.js';
import type { FieldConfig } from '~/types/contentEditor';

const meta: Meta<typeof ContentEditor> = {
  title: 'Editor/ContentEditor',
  component: ContentEditor,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof ContentEditor>;

const jsonFields: FieldConfig[] = [
  { type: 'json', key: 'key', label: 'Key', required: true },
];

// Renders the editor plus a "Validate" button that calls the exposed
// validate() (what EntrySidebar's Save/Publish do) and prints the result.
function renderWithValidate(initial: Record<string, unknown>) {
  return () => ({
    components: { ContentEditor },
    setup() {
      const editor = ref<{ validate: () => Promise<boolean> } | null>(null);
      const state = ref<Record<string, unknown>>({ ...initial });
      const result = ref('');
      async function run() {
        result.value = String(await editor.value!.validate());
      }
      return { editor, state, result, run, fields: jsonFields };
    },
    template: `
      <div>
        <ContentEditor ref="editor" v-model:state="state" title="Puzzle" :fields="fields" />
        <button data-testid="run-validate" @click="run">Validate</button>
        <output data-testid="validate-result">{{ result }}</output>
        <pre data-testid="state">{{ JSON.stringify(state) }}</pre>
      </div>`,
  });
}

async function getView(canvasElement: HTMLElement): Promise<EditorView> {
  const host = await within(canvasElement).findByTestId(QA_JSON_FIELD.EDITOR);
  const content = await waitFor(() => {
    const el = host.querySelector<HTMLElement>('.cm-content');
    if (!el) throw new Error('editor not mounted');
    return el;
  });
  return EditorView.findFromDOM(content)!;
}

async function validate(canvasElement: HTMLElement): Promise<string> {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByTestId('run-validate'));
  return waitFor(() => {
    const text = canvas.getByTestId('validate-result').textContent ?? '';
    if (!text) throw new Error('validate pending');
    return text;
  });
}

// A valid JSON edit lands in the form state and validation passes.
export const JsonValid: Story = {
  render: renderWithValidate({ key: { b: 'e' } }),
  play: async ({ canvasElement }) => {
    const view = await getView(canvasElement);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '{"c":"d"}' },
    });
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByTestId('state').textContent).toBe('{"key":{"c":"d"}}')
    );
    expect(await validate(canvasElement)).toBe('true');
  },
};

// Broken JSON left in the editor blocks validation (Save/Publish) instead of
// silently saving the last valid value.
export const JsonInvalidBlocksSave: Story = {
  render: renderWithValidate({ key: { b: 'e' } }),
  play: async ({ canvasElement }) => {
    const view = await getView(canvasElement);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '{"c":' },
    });
    expect(await validate(canvasElement)).toBe('false');
  },
};

// Clearing a required JSON field sets it to null and fails the required check.
export const JsonRequiredCleared: Story = {
  render: renderWithValidate({ key: { b: 'e' } }),
  play: async ({ canvasElement }) => {
    const view = await getView(canvasElement);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '' },
    });
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByTestId('state').textContent).toBe('{"key":null}')
    );
    expect(await validate(canvasElement)).toBe('false');
    expect(await canvas.findByText('Key is required')).toBeTruthy();
  },
};
