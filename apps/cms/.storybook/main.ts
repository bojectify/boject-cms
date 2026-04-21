import type { StorybookConfig } from '@storybook/vue3-vite';
import { fileURLToPath } from 'node:url';

const repoRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|js)'],
  addons: [],
  framework: {
    name: '@storybook/vue3-vite',
    options: {},
  },
  docs: { autodocs: 'tag' },
  async viteFinal(vite) {
    const { default: ui } = await import('@nuxt/ui/vite');
    vite.plugins ??= [];
    vite.plugins.push(
      ui({
        // Tailwind preflight is included via the runtime CSS import in preview.ts
      })
    );
    vite.resolve ??= {};
    vite.resolve.alias = {
      ...(vite.resolve.alias ?? {}),
      '~': repoRoot('..'),
      '~~': repoRoot('..'),
      '@': repoRoot('..'),
    };
    return vite;
  },
};

export default config;
