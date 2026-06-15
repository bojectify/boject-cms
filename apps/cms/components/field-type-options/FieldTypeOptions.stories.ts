import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import FieldTypeOptions from './FieldTypeOptions.vue';
import { QA_FIELD_TYPE_OPTIONS } from './fieldTypeOptions.config.js';

const meta: Meta<typeof FieldTypeOptions> = {
  title: 'FieldModal/FieldTypeOptions',
  component: FieldTypeOptions,
  parameters: { layout: 'centered' },
  args: {
    contentTypeOptions: [],
    updateOptions: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof FieldTypeOptions>;

// BOOLEAN — the default control is a USwitch (role="switch"); toggling it ON
// emits updateOptions({ default: true }).
export const BooleanDefault: Story = {
  args: { type: 'BOOLEAN', options: {} },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByTestId(QA_FIELD_TYPE_OPTIONS.DEFAULT);
    await userEvent.click(toggle);
    expect(args.updateOptions).toHaveBeenCalledWith({ default: true });
  },
};

// SELECT — with choices, a "Default value" USelect renders. Opening it and
// picking 'b' emits updateOptions({ default: 'b' }). The listbox teleports to
// <body>, so the option is found there, not in the canvas.
export const SelectDefault: Story = {
  args: { type: 'SELECT', options: { choices: ['a', 'b'] } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId(QA_FIELD_TYPE_OPTIONS.DEFAULT);
    await userEvent.click(trigger);
    // Reka Select teleports its listbox to body; the option carries the label.
    const body = within(document.body);
    const option = await body.findByRole('option', { name: 'b' });
    await userEvent.click(option);
    expect(args.updateOptions).toHaveBeenCalledWith({ default: 'b' });
  },
};

// SELECT with no choices — the "Default value" control is hidden (you can't pick
// a default until at least one choice exists).
export const SelectDefaultHiddenWithoutChoices: Story = {
  args: { type: 'SELECT', options: { choices: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Default value')).toBeNull();
  },
};
