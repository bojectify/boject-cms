# Storybook 10 + Vitest Browser Interaction Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap Storybook 10 on this Nuxt 4 CMS with Playwright-driven Vitest browser interaction tests and a reusable three-layer mocking strategy (MSW / module aliases / decorators), proven out by two seed stories.

**Architecture:** `@storybook/vue3-vite@10.3.x` **directly** (not via `@nuxtjs/storybook`). Nuxt UI's standalone Vite plugin (`@nuxt/ui/vite`) handles `<UButton>` / `<UIcon>` / Tailwind inside Storybook. Stories run as Vitest 4 browser tests via `@storybook/addon-vitest` + `@vitest/browser-playwright`, sharing the repo's existing Vitest infrastructure under a new `storybook` project. `~` / `~~` path aliases mapped to `apps/cms/`.

**Tech Stack:** Storybook 10.3.x, `@storybook/vue3-vite`, `@storybook/addon-vitest`, Vitest 4.1.x browser mode, `@vitest/browser-playwright`, Chromium, `@nuxt/ui/vite`, MSW 2, `msw-storybook-addon`.

**Prerequisite:** Issue #92 is the prerequisite of #36. This plan produces infra with no coupling to #36's implementation — each seed story is independent.

## Pivot from initial plan

The original plan targeted Storybook 9 via `@nuxtjs/storybook` because `@nuxtjs/storybook@9.0.1` pins `storybook: ~9.0.5`. Trying that revealed `@storybook-vue/nuxt@9.0.1` peers on `nuxt: ^3.13.0` — incompatible with our Nuxt 4.3. We pivoted to `@storybook/vue3-vite` directly, which unlocks Storybook 10 and `@storybook/addon-vitest` (the Playwright-backed Vitest runner that replaces `@storybook/test-runner`). Component tests in isolation are a better fit than dragging the full Nuxt app surface into Storybook anyway.

---

## File Structure

**New files:**

- `apps/cms/.storybook/main.ts` — Storybook config (framework, Nuxt UI Vite plugin, path aliases).
- `apps/cms/.storybook/preview.ts` — Global decorators, Nuxt UI CSS import, MSW initialize.
- `apps/cms/.storybook/README.md` — Documents the three-layer mocking conventions.
- `apps/cms/.storybook/mocks/handlers.ts` — Default MSW handlers (content-types, content-entries).
- `apps/cms/.storybook/decorators/withAppProvides.ts` — Global decorator for Vue `provide` context.
- `apps/cms/.storybook/mocks/routeProvider.ts` — Decorator that stubs `vue-router`'s injected route (fixes `<UButton :to>` inject warning).
- `apps/cms/components/relation-field/RelationField.stories.ts` — Seed story (no MSW, no mocks).
- `apps/cms/components/entry-picker-modal/EntryPickerModal.stories.ts` — Seed story (MSW + module alias + decorator).
- `apps/cms/composables/useUserSession.mock.ts` — Example module mock.
- `apps/cms/composables/useToast.mock.ts` — Example module mock for the toast composable.

**Modified files:**

- `apps/cms/package.json` — devDeps, `storybook`, `storybook:build`, `test:storybook` scripts.
- `apps/cms/vitest.config.ts` — Add `storybook` project with `storybookTest` plugin + `@vitejs/plugin-vue` + Playwright browser provider.
- `.gitignore` — Ignore `apps/cms/auto-imports.d.ts`, `apps/cms/components.d.ts`, `apps/cms/storybook-static/`.
- `lefthook.yml` — Optional `storybook:test` pre-push job (skippable via flag).

**Out-of-scope files:** No existing component source is modified. Seed stories consume components as-is.

---

## Task 1: ✅ Bootstrap Storybook 10 + `@storybook/vue3-vite`

**Status:** done on `feat/92-storybook-bootstrap` (commit `1fd6e73`).

Deliverables landed:

- `storybook@~10.3.5`, `@storybook/vue3-vite@~10.3.5`, `@vitejs/plugin-vue`.
- `.storybook/main.ts` with:
  - `@storybook/vue3-vite` framework.
  - `viteFinal` that loads `@nuxt/ui/vite` and aliases `~`, `~~`, `@` to `apps/cms/`.
  - `stories: ['../components/**/*.stories.@(ts|js)']`.
- `.storybook/preview.ts` importing `../assets/css/main.css` (Tailwind + Nuxt UI).
- `pnpm --filter cms storybook` boots on `http://localhost:6006`.
- `.gitignore` entries for `auto-imports.d.ts`, `components.d.ts`, `storybook-static/`.

Verification: `pnpm --filter cms storybook` prints `Storybook ready!`.

---

## Task 2: ✅ Add `@storybook/addon-vitest` + Playwright + first seed story

**Status:** done on `feat/92-storybook-bootstrap` (commit `1fd6e73`).

Deliverables landed:

- `@storybook/addon-vitest@~10.3.5`, `@vitest/browser@^4.1.5`, `@vitest/browser-playwright@^4.1.5`, `playwright`.
- `vitest@^4.1.5` (bumped from `4.0.18` to align with browser packages).
- `playwright install chromium` run.
- `vitest.config.ts` gains a `storybook` project:
  - `plugins: [vue(), storybookTest({ configDir: '.storybook' })]`
  - `browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] }`
- `pnpm --filter cms test:storybook` script.
- `components/relation-field/RelationField.stories.ts` with `Empty` and `Filled` stories (args only, no play functions yet).

Verification: `pnpm --filter cms test:storybook` passes 2 tests in Chromium in ~2.2s.

**Known noise (to clean up in Task 3):** `[Vue warn]: injection "Symbol(route location)" not found` from `<UButton :to>` expecting `vue-router` state.

---

## Task 3: Fix the `vue-router` injection warning with a decorator

**Files:**

- Create: `apps/cms/.storybook/decorators/routeProvider.ts`
- Modify: `apps/cms/.storybook/preview.ts`

Nuxt UI's `<UButton :to>` wraps `<router-link>`, which `inject`s a route location. In Storybook there's no router. A global decorator that `provide`s a minimal fake route silences the warning without pulling in full `vue-router`.

- [ ] **Step 1: Create the decorator**

Create `apps/cms/.storybook/decorators/routeProvider.ts`:

```ts
import type { Decorator } from '@storybook/vue3-vite';
import { h, provide, reactive } from 'vue';

// Symbols match vue-router's internal keys.
const routeLocationKey = Symbol('route location');
const routerViewLocationKey = Symbol('router view location');
const routerKey = Symbol('router');

const fakeRoute = reactive({
  path: '/',
  name: undefined,
  params: {},
  query: {},
  hash: '',
  fullPath: '/',
  matched: [],
  meta: {},
  redirectedFrom: undefined,
});

export const withFakeRoute: Decorator = (story) => ({
  setup() {
    provide(routeLocationKey, fakeRoute);
    provide(routerViewLocationKey, fakeRoute);
    provide(routerKey, {
      push: async () => {},
      replace: async () => {},
      resolve: (to: unknown) => ({ href: typeof to === 'string' ? to : '#' }),
      currentRoute: { value: fakeRoute },
    });
    return () => h(story());
  },
});
```

- [ ] **Step 2: Register globally**

Overwrite `apps/cms/.storybook/preview.ts`:

```ts
import type { Preview } from '@storybook/vue3-vite';
import '../assets/css/main.css';
import { withFakeRoute } from './decorators/routeProvider';

const preview: Preview = {
  decorators: [withFakeRoute],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
```

- [ ] **Step 3: Verify warning is gone**

```bash
pnpm --filter cms test:storybook
```

Expected: 2 tests pass, stderr does **not** contain `injection "Symbol(route location)" not found`.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/.storybook/
git commit -m "chore(storybook): provide fake vue-router context to silence UButton inject warning"
```

---

## Task 4: Add interaction tests to `RelationField` stories

**Files:**

- Modify: `apps/cms/components/relation-field/RelationField.stories.ts`

- [ ] **Step 1: Install `@storybook/test`**

```bash
pnpm --filter cms add -D "@storybook/test@~10.3.5"
```

- [ ] **Step 2: Expand the stories with `play` functions**

Overwrite `apps/cms/components/relation-field/RelationField.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite';
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

- [ ] **Step 3: Run the test-runner**

```bash
pnpm --filter cms test:storybook
```

Expected: 2 stories pass with interactions.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/package.json apps/cms/components/relation-field/RelationField.stories.ts pnpm-lock.yaml
git commit -m "test(storybook): add interaction tests for RelationField"
```

---

## Task 5: Wire MSW via `msw-storybook-addon`

**Files:**

- Modify: `apps/cms/package.json` (deps + note on service worker)
- Modify: `apps/cms/.storybook/preview.ts`
- Create: `apps/cms/.storybook/mocks/handlers.ts`
- Create: `apps/cms/public/mockServiceWorker.js` (via `msw init`)

- [ ] **Step 1: Install MSW packages**

```bash
pnpm --filter cms add -D "msw@^2.0.0" "msw-storybook-addon@^2.0.7"
```

- [ ] **Step 2: Install the MSW service worker into Nuxt's public dir**

```bash
pnpm --filter cms exec msw init public/ --save
```

Expected: `apps/cms/public/mockServiceWorker.js` created. Commit it — Storybook serves it at the origin via Vite.

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

Update `apps/cms/.storybook/preview.ts`:

```ts
import type { Preview } from '@storybook/vue3-vite';
import '../assets/css/main.css';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { withFakeRoute } from './decorators/routeProvider';
import { defaultHandlers } from './mocks/handlers';

initialize({ onUnhandledRequest: 'bypass' });

const preview: Preview = {
  loaders: [mswLoader],
  decorators: [withFakeRoute],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    msw: { handlers: defaultHandlers },
  },
};

export default preview;
```

- [ ] **Step 5: Verify existing tests still pass**

```bash
pnpm --filter cms test:storybook
```

Expected: 2 tests still pass. (MSW is now loaded but no story hits the network yet.)

- [ ] **Step 6: Commit**

```bash
git add apps/cms/package.json apps/cms/.storybook/ apps/cms/public/mockServiceWorker.js pnpm-lock.yaml
git commit -m "chore(storybook): add msw-storybook-addon with default handlers"
```

---

## Task 6: Add module mocking infrastructure

**Files:**

- Modify: `apps/cms/.storybook/main.ts`
- Create: `apps/cms/composables/useUserSession.mock.ts`
- Create: `apps/cms/composables/useToast.mock.ts`

- [ ] **Step 1: Create the user-session mock**

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

- [ ] **Step 2: Create the toast mock**

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

- [ ] **Step 3: Register the aliases in `.storybook/main.ts`**

Edit `apps/cms/.storybook/main.ts`'s `viteFinal` to append the module-mock aliases:

```ts
vite.resolve.alias = {
  ...(vite.resolve.alias ?? {}),
  '~': repoRoot('..'),
  '~~': repoRoot('..'),
  '@': repoRoot('..'),
  // Storybook-only swaps: imports of these paths resolve to the `.mock.ts`
  // sibling in Storybook, and to the real file everywhere else.
  '~/composables/useUserSession': repoRoot(
    '../composables/useUserSession.mock.ts'
  ),
  '~/composables/useToast': repoRoot('../composables/useToast.mock.ts'),
};
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
pnpm --filter cms test:storybook
```

Expected: 2 tests still pass. Mocks are registered but not yet exercised (that's Task 7).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/.storybook/main.ts apps/cms/composables/useUserSession.mock.ts apps/cms/composables/useToast.mock.ts
git commit -m "chore(storybook): add module mocking for useUserSession and useToast"
```

---

## Task 7: `EntryPickerModal` story exercising all three layers

**Files:**

- Create: `apps/cms/components/entry-picker-modal/EntryPickerModal.stories.ts`

- [ ] **Step 1: Write the story**

Create `apps/cms/components/entry-picker-modal/EntryPickerModal.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite';
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
    // Nuxt UI's UModal portals to document.body — search from body, not canvas.
    const canvas = within(canvasElement.ownerDocument.body);

    await waitFor(() => {
      expect(canvas.getByText('Ada Lovelace')).toBeInTheDocument();
      expect(canvas.getByText('Grace Hopper')).toBeInTheDocument();
      expect(canvas.getByText('Radia Perlman')).toBeInTheDocument();
    });

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

- [ ] **Step 2: Smoke-check in the browser**

Optional but recommended before running the test-runner: boot Storybook and eyeball the modal renders correctly (`pnpm --filter cms storybook`, navigate to `Components/EntryPickerModal/OpenWithAuthors`). Kill once confirmed.

- [ ] **Step 3: Run the test-runner**

```bash
pnpm --filter cms test:storybook
```

Expected: all four stories (RelationField Empty/Filled + EntryPickerModal OpenWithAuthors/SearchFilters) pass.

- [ ] **Step 4: Debugging guidance (if the search story fails)**

If the `SearchFilters` play function fails at the "queryByText for Ada not in document" assertion, the component's search filter may be debounced or async in a way the test doesn't wait for. Increase the `waitFor` timeout to 2000ms or switch the input selector to `canvas.getByRole('searchbox')`. Do **not** modify the component; adjust the story.

If the modal doesn't render (no text found), it's likely a portal-target issue — add `layout: 'fullscreen'` to the story's `parameters` and ensure `within(canvasElement.ownerDocument.body)` is being used (not `within(canvasElement)`).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/components/entry-picker-modal/EntryPickerModal.stories.ts
git commit -m "test(storybook): add interaction tests for EntryPickerModal covering all three mocking layers"
```

---

## Task 8: Document the three-layer mocking conventions

**Files:**

- Create: `apps/cms/.storybook/README.md`
- Modify: `CLAUDE.md` (add Storybook bullet under Testing)

- [ ] **Step 1: Write the Storybook README**

Create `apps/cms/.storybook/README.md`:

````markdown
# Storybook Conventions

This app uses Storybook 10 via `@storybook/vue3-vite` (not `@nuxtjs/storybook` — Nuxt 4 peer incompatibility). Interaction tests run as Vitest browser tests via `@storybook/addon-vitest` + `@vitest/browser-playwright` on Chromium.

## Commands

- `pnpm --filter cms storybook` — dev server on `http://localhost:6006`
- `pnpm --filter cms storybook:build` — static build into `apps/cms/storybook-static/`
- `pnpm --filter cms test:storybook` — run `play` functions through Playwright (shares the Vitest config)

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

Stories import from the aliased path, and the `.mock.ts` sibling provides a fake implementation.

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

| Boundary                    | Tool               | Example                                          |
| --------------------------- | ------------------ | ------------------------------------------------ |
| Network (`fetch`, `$fetch`) | MSW                | `/api/content-entries` list                      |
| Module import               | Alias + `.mock.ts` | `useUserSession`, `useToast`, `navigateTo`       |
| Provide/inject              | Decorator          | `paneOrchestrator` (from #36), `vue-router` stub |

## Adding a new story

1. Create `<Component>.stories.ts` next to the component.
2. If it hits the network, add per-story MSW handlers (or rely on defaults).
3. If it calls an auto-imported composable, check whether there's a `.mock.ts` for it; add one if not and alias in `main.ts`.
4. Write a `play` function using `@storybook/test` (`userEvent`, `within`, `expect`).
5. Run `pnpm --filter cms test:storybook` locally before pushing.
````

- [ ] **Step 2: Add a Storybook bullet to CLAUDE.md under Testing**

Append to the `## Testing` section in `CLAUDE.md`:

```markdown
- **Storybook** — Storybook 10 via `@storybook/vue3-vite` (direct, not `@nuxtjs/storybook`). Interaction tests run as a Vitest `storybook` project in browser mode via `@storybook/addon-vitest` + `@vitest/browser-playwright`. See `apps/cms/.storybook/README.md` for the three-layer mocking conventions (MSW for network, module aliases for imports, decorators for provide/inject).
```

- [ ] **Step 3: Commit**

```bash
git add apps/cms/.storybook/README.md CLAUDE.md
git commit -m "docs(storybook): document three-layer mocking conventions"
```

---

## Task 9: Wire `test:storybook` into pre-push

**Files:**

- Modify: `lefthook.yml`

The repo uses lefthook instead of CI. `test:storybook` reuses the existing Vitest infra, so it integrates naturally alongside the main `test` job.

- [ ] **Step 1: Add a pre-push job**

Edit `lefthook.yml`:

```yaml
pre-push:
  jobs:
    - name: test
      run: pnpm test
      skip:
        - run: test "$WALLABY_VERIFIED" = "1"

    - name: storybook-test
      run: pnpm --filter cms test:storybook
      skip:
        - run: test "$SKIP_STORYBOOK_TEST" = "1"
```

- [ ] **Step 2: Verify the hook fires**

With a trivial commit on the branch:

```bash
git push --dry-run
```

Expected: both `test` and `storybook-test` jobs execute; both pass. Total added time should be ≤10s for the Storybook job (given the fast initial run we measured).

- [ ] **Step 3: Runtime check**

If `storybook-test` runtime exceeds ~30s per push in practice, reconsider making it opt-in (demote to `SKIP_STORYBOOK_TEST` default-true, run it explicitly via `pnpm --filter cms test:storybook` or in GitHub Actions when/if CI is added). For now, default-on is consistent with the existing `test` job pattern.

- [ ] **Step 4: Commit**

```bash
git add lefthook.yml
git commit -m "chore(lefthook): run storybook interaction tests in pre-push"
```

---

## Task 10: Verify end-to-end, prepare PR

- [ ] **Step 1: Run every test suite**

```bash
pnpm test
pnpm --filter cms test:storybook
```

Expected: all green.

- [ ] **Step 2: Lint + typecheck + format**

```bash
pnpm lint
pnpm typecheck
pnpm format
```

All green.

- [ ] **Step 3: Check Wallaby**

Use the `wallaby_failingTests` MCP tool. If no failures, push with `WALLABY_VERIFIED=1 git push`. If Wallaby is unavailable, plain `git push` runs the full test hook.

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat: bootstrap storybook 10 + vitest browser interaction tests (#92)" --body "..."
```

PR body should include:

- Tech stack as deployed: Storybook 10 + `@storybook/vue3-vite` (direct) + `@storybook/addon-vitest` + `@vitest/browser-playwright` + `@nuxt/ui/vite`.
- Pivot rationale (Nuxt 4 vs `@nuxtjs/storybook` peer issue).
- Three-layer mocking stack (MSW / module aliases / decorators) documented in `.storybook/README.md`.
- Two seed stories (RelationField, EntryPickerModal) with interaction tests.
- Pre-push hook integration (skippable via `SKIP_STORYBOOK_TEST=1`).
- Closes #92, unblocks #36.

---

## Self-review notes

- **Spec coverage:** All ticket acceptance criteria map to tasks. `storybook` and `storybook:test` scripts (Tasks 1, 2 ✅). Three-layer mocking (Tasks 5, 6, plus the `routeProvider` decorator covering layer 3 in Task 3). Seed stories (Tasks 4, 7). README (Task 8). CI → pre-push (Task 9). Fallback to raw Playwright e2e is no longer needed — SB10 boots cleanly.

- **Noise resolved:** The `<UButton :to>` inject warning is addressed in Task 3.

- **Outstanding risks:**
  - MSW + Playwright browser mode: MSW 2 works in Vitest browser mode, but if the service worker registration behaves differently in headless Chromium, Task 5 verification may reveal a gap. Fallback: use MSW's `setupWorker` manually in `preview.ts` or switch to `msw/browser` direct.
  - Nuxt UI components portal-to-body: `EntryPickerModal` uses `<UModal>` which portals out of the canvas root. Task 7 scopes `within` to `ownerDocument.body`; if that doesn't work, `layout: 'fullscreen'` + adjusting selectors is the escape hatch documented in Task 7 Step 4.

- **Not in scope:** backfilling stories for existing components; visual regression; migration to `@nuxtjs/storybook` when it supports Nuxt 4 (opportunistic follow-up).
