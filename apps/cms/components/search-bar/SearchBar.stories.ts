import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import SearchBar from './SearchBar.vue';
import { QA_SEARCH_BAR } from './searchBar.config.js';
import { ContainerDecorator } from '../../.storybook/decorators';

const meta: Meta<typeof SearchBar> = {
  title: 'Search/SearchBar',
  component: SearchBar,
  parameters: { layout: 'centered' },
  // The bar fills its container (the page owns the width); bound it in isolation.
  decorators: [ContainerDecorator(700)],
  args: {
    placeholder: 'Search all content…',
    onOpen: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof SearchBar>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const bar = canvas.getByTestId(QA_SEARCH_BAR.COMPONENT);
    await expect(bar).toHaveTextContent('Search all content…');
    // clicking the launcher asks the host to open the palette
    await userEvent.click(bar);
    expect(args.onOpen).toHaveBeenCalledTimes(1);
  },
};
