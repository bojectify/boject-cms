import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import BooleanTriState from './BooleanTriState.vue';
import { QA_BOOLEAN_TRI_STATE } from './booleanTriState.config.js';

const meta: Meta<typeof BooleanTriState> = {
  title: 'Fields/BooleanTriState',
  component: BooleanTriState,
  parameters: { layout: 'centered' },
  args: {
    'onUpdate:modelValue': fn(),
  },
};
export default meta;
type Story = StoryObj<typeof BooleanTriState>;

// Unset (None) by default; clicking True emits `true`.
export const SelectTrue: Story = {
  args: { modelValue: undefined },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId(QA_BOOLEAN_TRI_STATE.TRUE));
    expect(args['onUpdate:modelValue']).toHaveBeenCalledWith(true);
  },
};

// With a value set, clicking None clears back to undefined (the unset state).
export const ClearToNone: Story = {
  args: { modelValue: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId(QA_BOOLEAN_TRI_STATE.NONE));
    expect(args['onUpdate:modelValue']).toHaveBeenCalledWith(undefined);
  },
};

// disableNone (required fields): None is disabled; True/False still emit.
export const NoneDisabled: Story = {
  args: { modelValue: undefined, disableNone: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId(QA_BOOLEAN_TRI_STATE.NONE)).toBeDisabled();
    await userEvent.click(canvas.getByTestId(QA_BOOLEAN_TRI_STATE.FALSE));
    expect(args['onUpdate:modelValue']).toHaveBeenCalledWith(false);
  },
};
