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
    const { default: vue } = await import('@vitejs/plugin-vue');
    vite.plugins ??= [];
    vite.plugins.push(
      vue(),
      ui({
        // Extend Nuxt UI's bundled unplugin-auto-import with the Vue preset
        // so components can call `ref`/`computed`/`watch` etc. without
        // explicit imports. Project composables (useAuthedFetch, useToast,
        // etc.) are NOT auto-imported here — stories that need them should
        // either import them explicitly via a module alias or mock them
        // via decorators (see apps/cms/.storybook/README.md).
        autoImport: {
          imports: ['vue'],
          dirs: [
            fileURLToPath(new URL('./shims', import.meta.url)),
            fileURLToPath(new URL('../composables', import.meta.url)),
            fileURLToPath(new URL('../utils', import.meta.url)),
          ],
        },
        // Extend Nuxt UI's bundled unplugin-vue-components so project
        // components in ../components/ are globally auto-registered in
        // Storybook (matching Nuxt's runtime behaviour).
        components: {
          dirs: [fileURLToPath(new URL('../components', import.meta.url))],
        },
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
