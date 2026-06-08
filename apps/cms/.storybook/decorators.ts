import type { Decorator } from '@storybook/vue3-vite';

/**
 * Wrap a story in a fixed-width container. Useful for components that fill
 * their parent (`width: 100%`) and would otherwise stretch to the full canvas
 * in isolation — pass the width you want to preview them at.
 *
 * @param width - CSS width; a bare number is treated as pixels.
 *
 * @example
 * const meta: Meta<typeof QueryBuilder> = {
 *   decorators: [ContainerDecorator(700)],
 * };
 */
export function ContainerDecorator(width: number | string): Decorator {
  const w = typeof width === 'number' ? `${width}px` : width;
  return () => ({
    setup: () => ({ w }),
    template: `<div :style="{ width: w, maxWidth: '100%' }"><story /></div>`,
  });
}
