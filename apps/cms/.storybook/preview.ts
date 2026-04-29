import type { Preview } from '@storybook/vue3-vite';
import { setup } from '@storybook/vue3-vite';
import { createMemoryHistory, createRouter } from 'vue-router';
import { h } from 'vue';
import ui from '@nuxt/ui/vue-plugin';
import { initialize, mswLoader } from 'msw-storybook-addon';
import '../assets/css/main.css';
import { defaultHandlers } from './mocks/handlers';

// Give Nuxt UI's <UButton :to> (which wraps <RouterLink>) a real router
// so it doesn't inject-miss on the vue-router context symbols.
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/:pathMatch(.*)*',
      component: { render: () => h('div') },
    },
  ],
});

setup((app) => {
  app.use(router);
  // Register Nuxt UI's runtime so theme tokens (primary colour, button
  // variants, switch/checkbox accents) flow through. Without this,
  // components render with structural classes only — borders/typography
  // come through but colour tokens fall back to defaults.
  app.use(ui);

  // Nuxt UI components occasionally render <NuxtLink>; in Storybook (no Nuxt
  // runtime) alias it to <RouterLink> so Vue doesn't warn about an unresolved
  // component.
  app.component('NuxtLink', {
    props: {
      to: { type: [String, Object], required: true },
      target: { type: String, default: undefined },
    },
    template: '<RouterLink :to="to" :target="target"><slot /></RouterLink>',
  });
});

initialize({ onUnhandledRequest: 'bypass' });

// Nuxt UI keys dark mode off the `dark` class on <html>. In the real app
// `@nuxtjs/color-mode` toggles it; in Storybook we drive it directly from
// the toolbar global. `auto` follows the OS via prefers-color-scheme and
// keeps tracking it via a media query listener so the canvas flips when
// the OS does.
type ThemeGlobal = 'light' | 'dark' | 'auto';

const autoMql =
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

let autoListener: ((e: MediaQueryListEvent) => void) | null = null;

function applyTheme(theme: ThemeGlobal) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (autoListener && autoMql) {
    autoMql.removeEventListener('change', autoListener);
    autoListener = null;
  }

  if (theme === 'auto') {
    const sync = () => root.classList.toggle('dark', !!autoMql?.matches);
    sync();
    if (autoMql) {
      autoListener = sync;
      autoMql.addEventListener('change', autoListener);
    }
    return;
  }

  root.classList.toggle('dark', theme === 'dark');
}

const preview: Preview = {
  loaders: [mswLoader],
  globalTypes: {
    theme: {
      description: 'Colour theme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
          { value: 'auto', icon: 'mirror', title: 'OS preference' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (story, ctx) => {
      applyTheme((ctx.globals.theme ?? 'light') as ThemeGlobal);
      return story();
    },
  ],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    msw: { handlers: defaultHandlers },
  },
};

export default preview;
