# Storybook Conventions

This app uses **Storybook 10** via `@storybook/vue3-vite` (not `@nuxtjs/storybook` — Nuxt 4 peer incompatibility at the time of writing). Interaction tests run as Vitest 4 browser tests via `@storybook/addon-vitest` + `@vitest/browser-playwright` on Chromium.

## Commands

- `pnpm --filter cms storybook` — dev server on `http://localhost:6006`
- `pnpm --filter cms storybook:build` — static build into `apps/cms/storybook-static/`
- `pnpm --filter cms test:storybook` — run `play` functions through Playwright (shares the Vitest config)

## Three-layer mocking

Each layer mocks at a different boundary. Pick the right one for what you're replacing.

### 1. Network — MSW (`msw-storybook-addon`)

For `/api/*` responses. Defaults live in `.storybook/mocks/handlers.ts`; override per story via `parameters.msw.handlers`:

```ts
import { http, HttpResponse } from 'msw';

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/content-entries', () =>
          HttpResponse.json({ error: 'Boom' }, { status: 500 })
        ),
      ],
    },
  },
};
```

Same handler fixtures can be reused from Vitest and Playwright later.

### 2. Module imports — aliases + optional `unplugin-auto-import` dirs

For code that imports from a known path. Add to `.storybook/main.ts`'s `viteFinal.resolve.alias`:

```ts
vite.resolve.alias = {
  ...(vite.resolve.alias ?? {}),
  '~/composables/useRelationResolver': fileURLToPath(
    new URL('./shims/useRelationResolver.mock.ts', import.meta.url)
  ),
};
```

Then stories / components importing from `~/composables/useRelationResolver` get the mock in Storybook and the real thing everywhere else.

For Nuxt-auto-imported helpers (`useAuthedFetch`, `$fetch`, `useToast`, `navigateTo`, etc.) that appear as globals in components, consider extending Nuxt UI's bundled `unplugin-auto-import` via its `autoImport.dirs` option (see `main.ts`) and pointing it at a Storybook-only shims directory. Not set up today — components using these auto-imports need a per-story workaround until that plumbing lands.

### 3. Provide/inject — decorators

For Vue `provide` / app context. Global decorators live in `.storybook/preview.ts`; per-story decorators go in the story file:

```ts
export const WithOrchestrator: Story = {
  decorators: [
    (story) => ({
      setup() {
        provide('paneOrchestrator', {
          openPane: fn(),
          openPicker: fn(),
        });
        return () => h(story());
      },
    }),
  ],
};
```

Global example in `preview.ts`: we install a memory-history `vue-router` via Storybook's `setup(app)` hook so Nuxt UI's `<UButton :to>` (which wraps `<RouterLink>`) doesn't inject-miss.

## When to use which

| Boundary                      | Tool                                      | Example                           |
| ----------------------------- | ----------------------------------------- | --------------------------------- |
| Network (`fetch`, `$fetch`)   | MSW                                       | `/api/content-entries` list       |
| Module import (explicit path) | Vite alias + `.mock.ts`                   | Swap a composable in stories only |
| Nuxt auto-imports (globals)   | `unplugin-auto-import` dir + shim         | `useAuthedFetch`, `useToast`      |
| Provide/inject                | Decorator (`app.provide` or `setup(app)`) | `paneOrchestrator`, `vue-router`  |

## Adding a new story

1. Create `<Component>.stories.ts` next to the component.
2. If it hits the network, add per-story MSW handlers (or rely on defaults).
3. If it calls a Nuxt-auto-imported composable, first decide whether to refactor the component to take the dep as a prop (cleanest), shim it via alias, or skip the story for now.
4. Write a `play` function using `storybook/test` (`userEvent`, `within`, `expect`, `fn`).
5. Run `pnpm --filter cms test:storybook` locally before pushing.

## Files

- `main.ts` — framework + Vite plugin config (Nuxt UI, aliases).
- `preview.ts` — global decorators, CSS imports, MSW initialize.
- `mocks/handlers.ts` — shared MSW fixtures.
- `README.md` — this file.
