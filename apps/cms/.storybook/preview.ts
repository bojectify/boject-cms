import type { Preview } from '@storybook/vue3-vite';
import { setup } from '@storybook/vue3-vite';
import { createMemoryHistory, createRouter } from 'vue-router';
import { h } from 'vue';
import '../assets/css/main.css';

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
});

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
