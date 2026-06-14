import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import SearchColumnPicker from './SearchColumnPicker.vue';
import { QA_SEARCH_COLUMN_PICKER } from './searchColumnPicker.config.js';
import { ARTICLE_CT } from '~/utils/queryBuilder/fixtures';

const meta: Meta<typeof SearchColumnPicker> = {
  title: 'Search/SearchColumnPicker',
  component: SearchColumnPicker,
  parameters: { layout: 'centered' },
  args: {
    contentTypeIdentifier: 'Article',
    fields: ARTICLE_CT.fields,
    modelValue: ['summary'],
    'onUpdate:modelValue': fn(),
  },
};
export default meta;
type Story = StoryObj<typeof SearchColumnPicker>;

export const TogglesAColumn: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId(QA_SEARCH_COLUMN_PICKER.TRIGGER));
    // The popover content teleports to body and animates open — query the whole
    // document and use findByTestId (async, retries) to race the open animation.
    const body = within(document.body);
    const panel = await body.findByTestId(QA_SEARCH_COLUMN_PICKER.PANEL);
    await expect(panel).toBeInTheDocument();
    // 'author' (RELATION) is columnable + currently OFF — toggling adds it. The
    // testid is on the outer row <button>; click that (not the inner checkbox).
    await userEvent.click(
      body.getByTestId(QA_SEARCH_COLUMN_PICKER.ROW('author'))
    );
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith([
      'summary',
      'author',
    ]);
  },
};

export const RemovesAColumn: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId(QA_SEARCH_COLUMN_PICKER.TRIGGER));
    const body = within(document.body);
    await body.findByTestId(QA_SEARCH_COLUMN_PICKER.PANEL);
    // 'summary' is currently ON (modelValue: ['summary']) — toggling removes it.
    await userEvent.click(
      body.getByTestId(QA_SEARCH_COLUMN_PICKER.ROW('summary'))
    );
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith([]);
  },
};
