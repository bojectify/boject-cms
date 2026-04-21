import type { Preview } from '@storybook/vue3-vite';
import { setup } from '@storybook/vue3-vite';
import { createMemoryHistory, createRouter } from 'vue-router';
import { h } from 'vue';
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

const preview: Preview = {
  loaders: [mswLoader],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    msw: { handlers: defaultHandlers },
  },
};

export default preview;
