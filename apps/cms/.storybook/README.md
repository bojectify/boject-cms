# Storybook Conventions

This app uses **Storybook 10** via `@storybook/vue3-vite` (not `@nuxtjs/storybook` — Nuxt 4 peer incompatibility at the time of writing). Interaction tests run as Vitest 4 browser tests via `@storybook/addon-vitest` + `@vitest/browser-playwright` on Chromium.

## Commands

- `pnpm --filter cms storybook` — dev server on `http://localhost:6006`
- `pnpm --filter cms storybook:build` — static build into `apps/cms/storybook-static/`
- `pnpm --filter cms test:storybook` — run `play` functions through Playwright (shares the Vitest config)

## One-time setup: MSW service worker

`apps/cms/public/mockServiceWorker.js` is gitignored and not auto-generated on install (msw is intentionally blocked in `pnpm-workspace.yaml`'s `allowBuilds` as a supply-chain hardening measure — see `pnpm-workspace.yaml`). After your first `pnpm install`, generate it once:

```sh
pnpm --filter cms exec msw init public --no-save
```

Regenerate after any `msw` upgrade so the worker matches the installed version.

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

Nuxt-auto-imported helpers (`useAuthedFetch`, `$fetch`, `useToast`, `navigateTo`, `useRequestHeaders`, `useRequestFetch`) are wired into Storybook via the same `unplugin-auto-import` instance Nuxt UI bundles (see `main.ts`). Three directories feed it: `./shims/` (Nuxt globals), `../composables/` (real project composables — picked up by name), and `../utils/` (auto-imported helpers like `mapFieldToConfig`). Add a new shim by exporting it from `shims/nuxt-autoimports.ts`; project composables don't need shimming as long as their dependencies (`useFetch`, `$fetch`, etc.) are shimmed.

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
