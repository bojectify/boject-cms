# Storybook 9 + Playwright Interaction Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap Storybook 9 on this Nuxt 4 CMS with Playwright-driven interaction tests and a reusable three-layer mocking strategy (MSW / Storybook module mocks / decorators), proven out by two seed stories.

**Architecture:** `@nuxtjs/storybook@9.0.1` wraps Storybook 9 around the existing Nuxt app so auto-imports, composables, and aliases resolve as they do at runtime. `@storybook/test-runner@0.22.x` drives `play` functions through real Playwright browsers. MSW handles HTTP; Storybook subpath module mocking handles non-network imports; decorators handle provide/inject and app-level context.

**Tech Stack:** Storybook 9, `@nuxtjs/storybook`, `@storybook/test-runner`, Playwright, MSW 2, `msw-storybook-addon`.

**Prerequisite:** Issue #92 is the prerequisite of #36. This plan produces infra with no coupling to #36's implementation — each seed story is independent.

**Fallback (only if blocked during Task 1):** If `@nuxtjs/storybook@9.0.1` refuses to load on Nuxt 4.3, fall back to raw Playwright e2e against `pnpm dev` seeded via `boject_test`. Do not attempt to manually wire `storybook@10.x` without the Nuxt module — auto-import stubbing will cost more than the fallback.

---

## File Structure

**New files:**

- `apps/cms/.storybook/main.ts` — Storybook config (framework, addons, stories glob).
- `apps/cms/.storybook/preview.ts` — Global decorators, MSW initialize, auth context.
- `apps/cms/.storybook/README.md` — Documents the three-layer mocking conventions.
- `apps/cms/.storybook/mocks/` — Centralised MSW handler fixtures shared by stories.
- `apps/cms/.storybook/mocks/handlers.ts` — Default MSW handlers (content-types, content-entries).
- `apps/cms/.storybook/decorators/authenticated.ts` — Decorator seeding `useUserSession` mock.
- `apps/cms/public/mockServiceWorker.js` — MSW service worker (installed by `msw init`, gitignored override TBD — commit it).
- `apps/cms/components/relation-field/RelationField.stories.ts` — Seed story (no MSW).
- `apps/cms/components/entry-picker-modal/EntryPickerModal.stories.ts` — Seed story (MSW + module mock + decorator).
- `apps/cms/composables/useUserSession.mock.ts` — Example module mock.
- `apps/cms/composables/useToast.mock.ts` — Example module mock for the toast composable.

**Modified files:**

- `apps/cms/package.json` — Add devDependencies, `storybook` / `storybook:test` scripts.
- `apps/cms/nuxt.config.ts` — Register `@nuxtjs/storybook` module.
- `apps/cms/.gitignore` (or root `.gitignore`) — Ignore `storybook-static/` build output.
- `lefthook.yml` — Add optional `storybook:test` pre-push job (skippable via flag).

**Out-of-scope files:** No existing component source is modified by this plan. Seed stories consume components as-is.

---

## Task 1: Install Storybook and verify it boots

**Files:**

- Modify: `apps/cms/package.json`
- Modify: `apps/cms/nuxt.config.ts`
- Create: `apps/cms/.storybook/main.ts`
- Create: `apps/cms/.storybook/preview.ts`

- [ ] **Step 1: Add dependencies**

Run from repo root:

```bash
pnpm --filter cms add -D \
  @nuxtjs/storybook@9.0.1 \
  storybook@~9.0.5 \
  @storybook/vue3-vite \
  @storybook/addon-essentials
```

Expected: successful install, `apps/cms/package.json` updated.

- [ ] **Step 2: Register the Nuxt module**

Edit `apps/cms/nuxt.config.ts`: append `'@nuxtjs/storybook'` to the `modules` array.

```ts
// nuxt.config.ts (excerpt)
export default defineNuxtConfig({
  modules: [
    // ...existing modules
    '@nuxtjs/storybook',
  ],
});
```

- [ ] **Step 3: Create minimal `.storybook/main.ts`**

Create `apps/cms/.storybook/main.ts`:

```ts
import type { StorybookConfig } from '@storybook/vue3-vite';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|js)'],
  addons: ['@storybook/addon-essentials'],
  framework: {
    name: '@storybook/vue3-vite',
    options: {},
  },
  docs: { autodocs: 'tag' },
};

export default config;
```

- [ ] **Step 4: Create minimal `.storybook/preview.ts`**

Create `apps/cms/.storybook/preview.ts`:

```ts
import type { Preview } from '@storybook/vue3';

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
```

- [ ] **Step 5: Add storybook scripts**

Edit `apps/cms/package.json` `scripts` block, add:

```json
"storybook": "storybook dev -p 6006",
"storybook:build": "storybook build"
```

- [ ] **Step 6: Verify Storybook boots**

Run:

```bash
pnpm --filter cms storybook
```

Expected: dev server starts on `http://localhost:6006`, empty sidebar (no stories yet), no error overlay. Leave it running, open in browser, confirm, then kill it (`Ctrl+C`).

If Storybook fails to boot due to a `@nuxtjs/storybook` × Nuxt 4 incompatibility, **stop here** and escalate — do not hack around it. Fall back to raw Playwright e2e as documented in the ticket.

- [ ] **Step 7: Commit**

```bash
git add apps/cms/package.json apps/cms/nuxt.config.ts apps/cms/.storybook/ pnpm-lock.yaml
git commit -m "chore: bootstrap storybook 9 via @nuxtjs/storybook"
```

---

## Task 2: Add test-runner + first smoke story

**Files:**

- Modify: `apps/cms/package.json`
- Create: `apps/cms/components/relation-field/RelationField.stories.ts` (smoke-only; expanded in Task 6)

- [ ] **Step 1: Install test-runner and Playwright**

```bash
pnpm --filter cms add -D @storybook/test-runner@^0.22.0 playwright
pnpm --filter cms exec playwright install --with-deps chromium
```

Expected: Playwright Chromium binary installed.

- [ ] **Step 2: Add smoke story**

Create `apps/cms/components/relation-field/RelationField.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3';
import RelationField from './RelationField.vue';

const meta: Meta<typeof RelationField> = {
  title: 'Components/RelationField',
  component: RelationField,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof RelationField>;

export const Empty: Story = {
  args: {
    label: 'Author',
    required: false,
    value: null,
    entryTitle: null,
    contentTypeName: null,
  },
};
```

- [ ] **Step 3: Add test script**

Edit `apps/cms/package.json`:

```json
"storybook:test": "test-storybook --url http://localhost:6006"
```

- [ ] **Step 4: Verify the test-runner runs**

In one terminal:

```bash
pnpm --filter cms storybook
```

In another:

```bash
pnpm --filter cms storybook:test
```

Expected: test-runner discovers the `Empty` story, renders it headlessly, reports 1 passed. No interactions yet — this only verifies the test harness.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/package.json apps/cms/components/relation-field/RelationField.stories.ts pnpm-lock.yaml
git commit -m "chore: add @storybook/test-runner and a smoke story"
```

---

## Task 3: Wire MSW via `msw-storybook-addon`

**Files:**

- Modify: `apps/cms/package.json`
- Modify: `apps/cms/.storybook/preview.ts`
- Create: `apps/cms/.storybook/mocks/handlers.ts`
- Create: `apps/cms/public/mockServiceWorker.js` (via CLI)

- [ ] **Step 1: Install MSW packages**

```bash
pnpm --filter cms add -D msw@^2.0.0 msw-storybook-addon@^2.0.7
```

- [ ] **Step 2: Install the MSW service worker into Nuxt's public dir**

```bash
pnpm --filter cms exec msw init public/ --save
```

Expected: `apps/cms/public/mockServiceWorker.js` created. Commit this file — the test-runner needs it at the origin.

- [ ] **Step 3: Create the default handlers fixture**

Create `apps/cms/.storybook/mocks/handlers.ts`:

```ts
import { http, HttpResponse } from 'msw';

export const defaultHandlers = [
  http.get('/api/content-types/options', () =>
    HttpResponse.json([
      { label: 'Author', value: 'ct-author' },
      { label: 'Article', value: 'ct-article' },
    ])
  ),
  http.get('/api/content-types/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      fields: [{ identifier: 'title', type: 'ENTRY_TITLE' }],
    })
  ),
  http.get('/api/content-entries', ({ request }) => {
    const url = new URL(request.url);
    const ctId = url.searchParams.get('contentTypeId');
    return HttpResponse.json({
      items:
        ctId === 'ct-author'
          ? [
              { id: 'a1', data: { title: 'Ada Lovelace' } },
              { id: 'a2', data: { title: 'Grace Hopper' } },
            ]
          : [],
      total: ctId === 'ct-author' ? 2 : 0,
    });
  }),
];
```

- [ ] **Step 4: Initialise MSW in the preview**

Overwrite `apps/cms/.storybook/preview.ts`:

```ts
import type { Preview } from '@storybook/vue3';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { defaultHandlers } from './mocks/handlers';

initialize({ onUnhandledRequest: 'bypass' });

const preview: Preview = {
  loaders: [mswLoader],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    msw: { handlers: defaultHandlers },
  },
};

export default preview;
```

- [ ] **Step 5: Verify MSW is wired (no new assertion yet)**

Run Storybook, reload the existing `RelationField/Empty` story, open DevTools Network, observe the service worker is active (console log `[MSW] Mocking enabled`). Nothing calls the API yet, so no intercepted requests; this is a wiring check only.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/package.json apps/cms/.storybook/ apps/cms/public/mockServiceWorker.js pnpm-lock.yaml
git commit -m "chore: add msw-storybook-addon with default handlers"
```

---

## Task 4: Add Storybook module mocking infrastructure

**Files:**

- Modify: `apps/cms/.storybook/main.ts`
- Create: `apps/cms/composables/useUserSession.mock.ts`
- Create: `apps/cms/composables/useToast.mock.ts`

- [ ] **Step 1: Enable subpath imports in Storybook's Vite config**

Storybook 9 supports module mocking via the [subpath imports](https://storybook.js.org/docs/writing-stories/mocking-data-and-modules/mocking-modules) mechanism — no Vite plugin required as long as the aliases are declared in `.storybook/main.ts`. Edit `apps/cms/.storybook/main.ts`:

```ts
import type { StorybookConfig } from '@storybook/vue3-vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|js)'],
  addons: ['@storybook/addon-essentials'],
  framework: {
    name: '@storybook/vue3-vite',
    options: {},
  },
  docs: { autodocs: 'tag' },
  async viteFinal(vite) {
    vite.resolve ??= {};
    vite.resolve.alias = {
      ...(vite.resolve.alias ?? {}),
      // Storybook-only swaps: imports of these paths resolve to the `.mock.ts`
      // sibling in Storybook, and to the real file everywhere else.
      '~/composables/useUserSession': r(
        '../composables/useUserSession.mock.ts'
      ),
      '~/composables/useToast': r('../composables/useToast.mock.ts'),
    };
    return vite;
  },
};

export default config;
```

_Note:_ The real `useUserSession` is provided by the `nuxt-auth-utils` module (auto-imported), not a file in `composables/`. The mock file still lives at `composables/useUserSession.mock.ts` so the alias maps there, but the alias target path (`~/composables/useUserSession`) is what stories will import — see Task 7.

- [ ] **Step 2: Create the user-session mock**

Create `apps/cms/composables/useUserSession.mock.ts`:

```ts
import { ref } from 'vue';

export function useUserSession() {
  return {
    user: ref({
      id: 'u-storybook',
      email: 'storybook@example.com',
      firstName: 'Storybook',
      lastName: 'User',
    }),
    loggedIn: ref(true),
    clear: async () => {},
    fetch: async () => {},
  };
}
```

- [ ] **Step 3: Create the toast mock**

Create `apps/cms/composables/useToast.mock.ts`:

```ts
// Collected toasts are exposed via window.__storybook_toasts__ so play
// functions can assert on them.
type Toast = {
  title?: string;
  description?: string;
  color?: string;
};

declare global {
  interface Window {
    __storybook_toasts__: Toast[];
  }
}

if (typeof window !== 'undefined') {
  window.__storybook_toasts__ = [];
}

export function useToast() {
  return {
    add: (toast: Toast) => {
      if (typeof window !== 'undefined') {
        window.__storybook_toasts__.push(toast);
      }
    },
    remove: () => {},
    clear: () => {
      if (typeof window !== 'undefined') {
        window.__storybook_toasts__ = [];
      }
    },
  };
}
```

- [ ] **Step 4: Verify module mock resolves**

Reload Storybook. In the browser DevTools console on any story, run:

```js
// Nothing should log "real" — this will be exercised properly in Task 7.
```

No programmatic assertion yet — this is a wiring step. The mocks become observable in Task 7's interaction test.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/.storybook/main.ts apps/cms/composables/useUserSession.mock.ts apps/cms/composables/useToast.mock.ts
git commit -m "chore: add storybook module mocking for useUserSession and useToast"
```

---

## Task 5: Add the authenticated decorator

**Files:**

- Create: `apps/cms/.storybook/decorators/authenticated.ts`
- Modify: `apps/cms/.storybook/preview.ts`

- [ ] **Step 1: Create the decorator**

Create `apps/cms/.storybook/decorators/authenticated.ts`:

```ts
import type { Decorator } from '@storybook/vue3';
import { h } from 'vue';

// Storybook wraps every story in a Vue component; this decorator seeds the
// global `provide` with anything the CMS app depends on. Extend here when
// future stories need new injected values (e.g. the paneOrchestrator from #36).
export const withAppProvides: Decorator = (story) => ({
  setup() {
    // No provides required today — kept as a hook for future tickets. The
    // useUserSession swap in Task 4 already handles auth.
    return () => h(story());
  },
});
```

- [ ] **Step 2: Register the decorator globally**

Edit `apps/cms/.storybook/preview.ts`, add to the `decorators` array:

```ts
import type { Preview } from '@storybook/vue3';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { defaultHandlers } from './mocks/handlers';
import { withAppProvides } from './decorators/authenticated';

initialize({ onUnhandledRequest: 'bypass' });

const preview: Preview = {
  loaders: [mswLoader],
  decorators: [withAppProvides],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    msw: { handlers: defaultHandlers },
  },
};

export default preview;
```

- [ ] **Step 3: Commit**

```bash
git add apps/cms/.storybook/decorators/ apps/cms/.storybook/preview.ts
git commit -m "chore: add storybook authenticated decorator"
```

---

## Task 6: Expand RelationField story with interaction tests

**Files:**

- Modify: `apps/cms/components/relation-field/RelationField.stories.ts`

- [ ] **Step 1: Replace the smoke story with full coverage**

Overwrite `apps/cms/components/relation-field/RelationField.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, fn, userEvent, within } from '@storybook/test';
import RelationField from './RelationField.vue';

const meta: Meta<typeof RelationField> = {
  title: 'Components/RelationField',
  component: RelationField,
  tags: ['autodocs'],
  args: {
    onAdd: fn(),
    onEdit: fn(),
    onRemove: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof RelationField>;

export const Empty: Story = {
  args: {
    label: 'Author',
    required: false,
    value: null,
    entryTitle: null,
    contentTypeName: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const addBtn = await canvas.findByText(/add entry/i);
    await userEvent.click(addBtn);
    expect(args.onAdd).toHaveBeenCalledTimes(1);
  },
};

export const Filled: Story = {
  args: {
    label: 'Author',
    required: false,
    value: { contentTypeId: 'ct-author', entryId: 'a1' },
    entryTitle: 'Ada Lovelace',
    contentTypeName: 'Author',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByText('Ada Lovelace');
    await userEvent.click(card);
    expect(args.onEdit).toHaveBeenCalledTimes(1);
  },
};
```

- [ ] **Step 2: Install `@storybook/test`**

```bash
pnpm --filter cms add -D @storybook/test@~9.0.5
```

- [ ] **Step 3: Run the test-runner against the expanded story**

With Storybook still running on 6006:

```bash
pnpm --filter cms storybook:test
```

Expected: both `Empty` and `Filled` stories pass. Interaction assertions confirm the `add` and `edit` events fire.

If `@storybook/test` isn't happy at that version, swap to `@storybook/test@~9.0.5` matching the `storybook` peer. Check with `pnpm view @storybook/test versions --json | grep '"9'`.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/package.json apps/cms/components/relation-field/RelationField.stories.ts pnpm-lock.yaml
git commit -m "test(storybook): add interaction tests for RelationField"
```

---

## Task 7: EntryPickerModal story exercising all three mocking layers

**Files:**

- Create: `apps/cms/components/entry-picker-modal/EntryPickerModal.stories.ts`

- [ ] **Step 1: Write the story**

Create `apps/cms/components/entry-picker-modal/EntryPickerModal.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';
import { http, HttpResponse } from 'msw';
import EntryPickerModal from './EntryPickerModal.vue';

const meta: Meta<typeof EntryPickerModal> = {
  title: 'Components/EntryPickerModal',
  component: EntryPickerModal,
  tags: ['autodocs'],
  args: {
    onSelect: fn(),
    onCreate: fn(),
    onClose: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof EntryPickerModal>;

export const OpenWithAuthors: Story = {
  args: {
    open: true,
    targetContentTypeIds: ['ct-author'],
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/content-types/options', () =>
          HttpResponse.json([{ label: 'Author', value: 'ct-author' }])
        ),
        http.get('/api/content-types/:id', ({ params }) =>
          HttpResponse.json({
            id: params.id,
            fields: [{ identifier: 'title', type: 'ENTRY_TITLE' }],
          })
        ),
        http.get('/api/content-entries', () =>
          HttpResponse.json({
            items: [
              { id: 'a1', data: { title: 'Ada Lovelace' } },
              { id: 'a2', data: { title: 'Grace Hopper' } },
              { id: 'a3', data: { title: 'Radia Perlman' } },
            ],
            total: 3,
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body); // modal portals to <body>

    // MSW layer — the list loads from the fetch
    await waitFor(() => {
      expect(canvas.getByText('Ada Lovelace')).toBeInTheDocument();
      expect(canvas.getByText('Grace Hopper')).toBeInTheDocument();
      expect(canvas.getByText('Radia Perlman')).toBeInTheDocument();
    });

    // Interaction — select an entry
    await userEvent.click(canvas.getByText('Ada Lovelace'));
    expect(args.onSelect).toHaveBeenCalledWith({
      contentTypeId: 'ct-author',
      entryId: 'a1',
      entryTitle: 'Ada Lovelace',
    });
  },
};

export const SearchFilters: Story = {
  args: {
    open: true,
    targetContentTypeIds: ['ct-author'],
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/content-types/options', () =>
          HttpResponse.json([{ label: 'Author', value: 'ct-author' }])
        ),
        http.get('/api/content-types/:id', ({ params }) =>
          HttpResponse.json({
            id: params.id,
            fields: [{ identifier: 'title', type: 'ENTRY_TITLE' }],
          })
        ),
        http.get('/api/content-entries', () =>
          HttpResponse.json({
            items: [
              { id: 'a1', data: { title: 'Ada Lovelace' } },
              { id: 'a2', data: { title: 'Grace Hopper' } },
            ],
            total: 2,
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);

    await waitFor(() =>
      expect(canvas.getByText('Ada Lovelace')).toBeInTheDocument()
    );

    const search = canvas.getByPlaceholderText(/search/i);
    await userEvent.type(search, 'Grace');

    await waitFor(() => {
      expect(canvas.queryByText('Ada Lovelace')).not.toBeInTheDocument();
      expect(canvas.getByText('Grace Hopper')).toBeInTheDocument();
    });
  },
};
```

- [ ] **Step 2: Run the story in the browser first**

Open `http://localhost:6006`, navigate to `Components → EntryPickerModal → OpenWithAuthors`. Verify the modal renders with three authors. Check DevTools → Application → Service Workers → MSW is active. If the modal doesn't render (portals to `document.body`, which Storybook may or may not isolate) add to `parameters`:

```ts
layout: 'fullscreen',
```

- [ ] **Step 3: Run the test-runner**

```bash
pnpm --filter cms storybook:test
```

Expected: all four stories (RelationField Empty/Filled + EntryPickerModal OpenWithAuthors/SearchFilters) pass.

- [ ] **Step 4: Debugging guidance (if the search story fails)**

The `SearchFilters` play function assumes the component debounces the search via a `watch` on `searchQuery`. The existing component filters client-side synchronously — if the filter does not apply, increase the `waitFor` timeout to 2000ms or inspect whether the search input selector needs to be more specific (e.g. `canvas.getByRole('searchbox')`). Do **not** modify the component; adjust the story.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/components/entry-picker-modal/EntryPickerModal.stories.ts
git commit -m "test(storybook): add interaction tests for EntryPickerModal"
```

---

## Task 8: Document the three-layer mocking conventions

**Files:**

- Create: `apps/cms/.storybook/README.md`
- Modify: `CLAUDE.md` (add a Storybook section under Testing)

- [ ] **Step 1: Write the Storybook README**

Create `apps/cms/.storybook/README.md`:

````markdown
# Storybook Conventions

This app uses Storybook 9 via `@nuxtjs/storybook` with `@storybook/test-runner` driving Playwright for interaction tests.

## Commands

- `pnpm --filter cms storybook` — dev server on `http://localhost:6006`
- `pnpm --filter cms storybook:build` — static build into `apps/cms/storybook-static/`
- `pnpm --filter cms storybook:test` — run `play` functions through Playwright (requires dev server running)

## Three-layer mocking

Each layer mocks at a different boundary. Pick the right one for what you're replacing.

### 1. Network — MSW (`msw-storybook-addon`)

For `/api/*` responses. Handlers live in `.storybook/mocks/handlers.ts` as defaults; override per story:

```ts
parameters: {
  msw: {
    handlers: [
      http.get('/api/content-entries', () => HttpResponse.json({ items: [] })),
    ],
  },
},
```

### 2. Module imports — Storybook aliases

For auto-imported composables and anything non-network you'd want to stub. Aliases are declared in `.storybook/main.ts`:

```ts
vite.resolve.alias = {
  '~/composables/useToast': r('../composables/useToast.mock.ts'),
};
```

Then stories import from the aliased path, and the `.mock.ts` sibling provides a fake implementation.

### 3. Provide/inject — Decorators

For Vue `provide` / Nuxt app context. Global decorators live in `.storybook/decorators/`; per-story decorators go in the story file:

```ts
export const MyStory: Story = {
  decorators: [
    (story) => ({
      setup() {
        provide('paneOrchestrator', { openPane: fn(), openPicker: fn() });
        return () => h(story());
      },
    }),
  ],
};
```

## When to use which

| Boundary                    | Tool               | Example                                    |
| --------------------------- | ------------------ | ------------------------------------------ |
| Network (`fetch`, `$fetch`) | MSW                | `/api/content-entries` list                |
| Module import               | Alias + `.mock.ts` | `useUserSession`, `useToast`, `navigateTo` |
| Provide/inject              | Decorator          | `paneOrchestrator` (from #36)              |

## Adding a new story

1. Create `<Component>.stories.ts` next to the component.
2. If it hits the network, add per-story MSW handlers (or rely on defaults).
3. If it calls an auto-imported composable, check whether there's a `.mock.ts` for it; add one if not and alias in `main.ts`.
4. Write a `play` function using `@storybook/test` (`userEvent`, `within`, `expect`).
5. Run `pnpm --filter cms storybook:test` locally before pushing.
````

- [ ] **Step 2: Add a Storybook section to CLAUDE.md**

Edit `CLAUDE.md` under the existing `## Testing` section. Append:

```markdown
- **Storybook** — Storybook 9 via `@nuxtjs/storybook`. Interaction tests via `@storybook/test-runner` (Playwright). See `apps/cms/.storybook/README.md` for the three-layer mocking conventions (MSW for network, module aliases for imports, decorators for provide/inject).
```

- [ ] **Step 3: Commit**

```bash
git add apps/cms/.storybook/README.md CLAUDE.md
git commit -m "docs: document storybook mocking conventions"
```

---

## Task 9: Wire storybook-test into pre-push

**Files:**

- Modify: `lefthook.yml`
- Modify: `apps/cms/package.json` (add a `storybook:ci` script that builds + tests)

- [ ] **Step 1: Add a `storybook:ci` script**

Boot + test in one command so the hook doesn't need a side-running server. Use `@storybook/test-runner`'s built-in ability to serve from a static build:

Edit `apps/cms/package.json`:

```json
"storybook:ci": "pnpm storybook:build && pnpm exec concurrently -k -s first -n SB,TEST \"pnpm exec http-server storybook-static --port 6006 --silent\" \"pnpm exec wait-on tcp:6006 && pnpm storybook:test\""
```

Add two devDeps:

```bash
pnpm --filter cms add -D concurrently http-server wait-on
```

- [ ] **Step 2: Add a pre-push job**

Edit `lefthook.yml`:

```yaml
pre-push:
  jobs:
    - name: test
      run: pnpm test
      skip:
        - run: test "$WALLABY_VERIFIED" = "1"

    - name: storybook-test
      run: pnpm --filter cms storybook:ci
      skip:
        - run: test "$SKIP_STORYBOOK_TEST" = "1"
```

- [ ] **Step 3: Verify the hook**

Run (dry-run the push):

```bash
SKIP_STORYBOOK_TEST=1 git push --dry-run
```

Expected: `storybook-test` job is skipped by condition.

Now without the flag (on a dummy commit or `git push --dry-run`):

```bash
git push --dry-run
```

Expected: `storybook:ci` runs, builds Storybook, starts the static server, runs the test-runner, all stories pass, hook exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/package.json lefthook.yml pnpm-lock.yaml
git commit -m "chore: wire storybook interaction tests into pre-push hook"
```

---

## Task 10: Verify end-to-end, prepare PR

- [ ] **Step 1: Run the full pre-push locally**

```bash
pnpm test
pnpm --filter cms storybook:ci
```

Expected: both pass.

- [ ] **Step 2: Lint + typecheck + format**

```bash
pnpm lint
pnpm typecheck
pnpm format
```

All green.

- [ ] **Step 3: Check Wallaby**

Use `wallaby_failingTests` MCP tool. If no failures, push with `WALLABY_VERIFIED=1 git push -u origin <branch>`. If Wallaby is unavailable, plain `git push` (full test hook will run, expect it to pass).

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat: bootstrap storybook + playwright interaction tests (#92)" --body "..."
```

PR body should list:

- Tech: Storybook 9 + @nuxtjs/storybook + @storybook/test-runner + msw-storybook-addon
- Three-layer mocking (MSW / aliases / decorators) documented in `.storybook/README.md`
- Two seed stories (RelationField, EntryPickerModal) with interaction tests
- Pre-push hook integration (skippable via `SKIP_STORYBOOK_TEST=1`)
- Closes #92, unblocks #36

---

## Self-review notes

- **Spec coverage:**
  - Install Storybook 9 via `@nuxtjs/storybook` → Task 1 ✓
  - Playwright-backed test runner via `@storybook/test-runner` → Task 2 ✓
  - MSW three-layer boundary #1 → Task 3 ✓
  - Module mocking three-layer boundary #2 → Task 4 ✓
  - Decorators three-layer boundary #3 → Task 5 ✓
  - Seed story: RelationField → Task 6 ✓
  - Seed story: EntryPickerModal → Task 7 ✓
  - README documenting layers → Task 8 ✓
  - CI (adapted to pre-push since repo has no CI) → Task 9 ✓
  - Fallback to raw Playwright e2e if Task 1 fails → documented at top

- **Type consistency:** `defaultHandlers`, `withAppProvides`, `useToast`, `useUserSession` used consistently; Task 7 overrides handlers via `parameters.msw.handlers` matching the wiring in Task 3.

- **Outstanding risk:** `@storybook/vue3-vite` must exist at a 9.x version that peers cleanly with `storybook@~9.0.5`. `@nuxtjs/storybook@9.0.1` is expected to pull it in — if not, add it to the explicit install list in Task 1. Verify during Task 1 step 1.

- **Pre-push hook tradeoff:** Adds ~30–60s to every push. If painful in practice, switch the `storybook-test` job to a separate opt-in script that only runs in a GitHub Action once CI exists. Not blocking this plan.
