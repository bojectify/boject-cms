# RTE Editor Presentation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three in-editor presentation gaps in the rich text editor (issue #115): unstyled headings, invisible `cmsLink` marks, and three toolbar buttons that always render green. Add a Storybook story as a permanent visual review surface.

**Architecture:** All changes land in `apps/cms/components/rich-text-editor/`. Markup edits go in `RichTextEditor.vue`'s template, presentation goes in a new `<style scoped>` block in the same SFC, and a new colocated `RichTextEditor.stories.ts` provides visual review. No new dependencies, no schema or server changes. Saved ProseMirror JSON, GraphQL output, and external consumer behaviour are unaffected.

**Tech Stack:** Vue 3 SFC + scoped CSS, Tailwind v4 (`@apply`), Nuxt UI v3 (`text-primary`, `UButton :color`), Tiptap (`@tiptap/vue-3`), Storybook 10 (`@storybook/vue3-vite`) + Vitest 4 browser mode.

**Spec:** `docs/superpowers/specs/2026-04-29-rte-editor-presentation-fixes-design.md`

---

## File Structure

| File                                                             | Change | Responsibility                                                                                                                                             |
| ---------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/components/rich-text-editor/RichTextEditor.vue`        | Modify | Drop `prose` classes, add wrapper class, add `<style scoped>` block with editor typography + link styling, fix toolbar `:color` bindings on three buttons. |
| `apps/cms/components/rich-text-editor/RichTextEditor.stories.ts` | Create | Single `AllStyledNodes` story with a preloaded ProseMirror doc covering every styled node and mark. Manual visual review surface.                          |

---

### Task 0: Create branch

**Files:** none

- [ ] **Step 1: Confirm clean working tree on `main`**

Run: `git status`
Expected: `nothing to commit, working tree clean` and `On branch main`.

- [ ] **Step 2: Create and switch to feature branch**

Run: `git checkout -b fix/rte-editor-presentation`
Expected: `Switched to a new branch 'fix/rte-editor-presentation'`.

---

### Task 1: Add Storybook story scaffold

Build the visual review surface first so subsequent CSS tasks can be verified in Storybook as they land.

**Files:**

- Create: `apps/cms/components/rich-text-editor/RichTextEditor.stories.ts`

- [ ] **Step 1: Write the story file**

Create `apps/cms/components/rich-text-editor/RichTextEditor.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import RichTextEditor from './RichTextEditor.vue';

const meta: Meta<typeof RichTextEditor> = {
  title: 'Components/RichTextEditor',
  component: RichTextEditor,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof RichTextEditor>;

const sampleDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Heading level 1' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Heading level 2' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Heading level 3' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse fermentum, justo ac molestie pulvinar.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A paragraph with an ' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          text: 'external URL link',
        },
        { type: 'text', text: ' and a ' },
        {
          type: 'text',
          marks: [
            {
              type: 'cmsLink',
              attrs: {
                contentTypeId: 'ct-author',
                entryId: 'a1',
                contentTypeIdentifier: 'Author',
              },
            },
          ],
          text: 'CMS entry link',
        },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Bullet item one' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Bullet item two' }],
            },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Numbered item one' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Numbered item two' }],
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'A blockquote line — used for callouts and pull quotes.',
            },
          ],
        },
      ],
    },
    {
      type: 'codeBlock',
      content: [{ type: 'text', text: 'const x = 1;\nconsole.log(x);' }],
    },
  ],
};

export const AllStyledNodes: Story = {
  args: {
    modelValue: sampleDoc,
    targetContentTypeIds: ['ct-author'],
    linkTargetContentTypeIds: ['ct-author'],
  },
};
```

**Why no `play` function:** the story has no user interaction. Toolbar buttons that would open `EntryPickerModal` (network fetch to `/api/content-entries`) and the `useToast` warning path inside `openCmsLinkPicker` are never triggered, so no MSW handlers or Nuxt auto-import shims are needed beyond the global Storybook config.

**Why no `cmsEmbed` node in the doc:** `CmsEmbedNodeView.vue` calls `useRelationResolver` → `useRequestFetch()`, a Nuxt-only auto-import. The Storybook README flags Nuxt auto-imports as not yet shimmed, so a `cmsEmbed` node would crash the story on mount. Out of scope for issue #115.

- [ ] **Step 2: Run the storybook test suite to confirm the story mounts**

Run: `pnpm --filter cms test:storybook`
Expected: PASS, including a result for the new `AllStyledNodes` story. The editor renders unstyled (this is fine — subsequent tasks add the styling); we are only confirming the editor mounts with the preloaded doc.

If you want to eyeball the unstyled "before" state, run `pnpm --filter cms storybook` and open `http://localhost:6006`. This is optional.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/components/rich-text-editor/RichTextEditor.stories.ts
git commit -m "test: add RichTextEditor storybook story (#115)"
```

---

### Task 2: Replace `prose` with hand-rolled scoped typography

**Files:**

- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.vue` (template + new `<style scoped>` block)

- [ ] **Step 1: Update the `<EditorContent>` class**

In `apps/cms/components/rich-text-editor/RichTextEditor.vue`, find:

```vue
<EditorContent
  :editor="editor"
  class="prose dark:prose-invert max-w-none p-4 min-h-[200px]"
/>
```

Replace with:

```vue
<EditorContent
  :editor="editor"
  class="rich-text-editor__content p-4 min-h-[200px]"
/>
```

- [ ] **Step 2: Add the scoped style block**

At the bottom of `apps/cms/components/rich-text-editor/RichTextEditor.vue` (after the existing `</template>`), append:

```vue
<style scoped>
.rich-text-editor__content :deep(h1) {
  @apply text-3xl font-bold mt-6 mb-2;
}
.rich-text-editor__content :deep(h2) {
  @apply text-2xl font-semibold mt-5 mb-2;
}
.rich-text-editor__content :deep(h3) {
  @apply text-xl font-semibold mt-4 mb-2;
}
.rich-text-editor__content :deep(p) {
  @apply my-2;
}
.rich-text-editor__content :deep(ul) {
  @apply list-disc pl-6 my-2;
}
.rich-text-editor__content :deep(ol) {
  @apply list-decimal pl-6 my-2;
}
.rich-text-editor__content :deep(blockquote) {
  @apply border-l-4 border-gray-300 dark:border-gray-700 pl-4 my-2 text-gray-600 dark:text-gray-400 italic;
}
.rich-text-editor__content :deep(code) {
  @apply font-mono text-sm bg-gray-100 dark:bg-gray-800 px-1 rounded;
}
.rich-text-editor__content :deep(pre) {
  @apply font-mono text-sm bg-gray-100 dark:bg-gray-800 p-3 rounded my-2 overflow-x-auto;
}
.rich-text-editor__content :deep(pre code) {
  @apply bg-transparent p-0;
}
</style>
```

**Why `:deep()`:** Vue SFC scoped CSS auto-namespaces selectors via a `data-v-…` attribute on elements that exist in this component's template. Tiptap renders heading/paragraph/list elements _inside_ `<EditorContent>` at runtime — they do not carry the scope attribute. `:deep()` rewrites the selector so it still applies. Without it, every rule above is a no-op.

- [ ] **Step 3: Eyeball in dev**

Run: `pnpm dev` (in another terminal, leave it running)

Open the CMS, edit any content type with a RICHTEXT field, open or create an entry, and confirm:

- H1 / H2 / H3 are visibly larger than body text and differ from each other.
- A bullet list shows bullet markers; an ordered list shows numbers.
- A blockquote shows a left border + muted italic.
- Code (inline ` and code blocks via the toolbar) renders in mono with a tinted background.

- [ ] **Step 4: Confirm Storybook still mounts**

Run: `pnpm --filter cms test:storybook`
Expected: PASS for `AllStyledNodes`.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/components/rich-text-editor/RichTextEditor.vue
git commit -m "fix(rte): hand-rolled scoped typography for editor content (#115)"
```

---

### Task 3: Style `.cms-link` marks and external links

**Files:**

- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.vue` (extend the `<style scoped>` block)

- [ ] **Step 1: Append link styling rules**

In `apps/cms/components/rich-text-editor/RichTextEditor.vue`, inside the `<style scoped>` block added in Task 2 (append after the existing rules, before `</style>`):

```css
.rich-text-editor__content :deep(a) {
  @apply text-primary underline;
}
.rich-text-editor__content :deep(a.cms-link)::before {
  content: '';
  display: inline-block;
  width: 0.875em;
  height: 0.875em;
  margin-right: 0.25em;
  vertical-align: -0.125em;
  background-color: currentColor;
  -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9 17H7A5 5 0 0 1 7 7h2'/><path d='M15 7h2a5 5 0 1 1 0 10h-2'/><line x1='8' y1='12' x2='16' y2='12'/></svg>") no-repeat center / contain;
  mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9 17H7A5 5 0 0 1 7 7h2'/><path d='M15 7h2a5 5 0 1 1 0 10h-2'/><line x1='8' y1='12' x2='16' y2='12'/></svg>") no-repeat center / contain;
}
</style>
```

(The closing `</style>` already exists from Task 2 — append the rules above the closing tag.)

**Why CSS mask + inline SVG:** the chain icon is a Lucide `link-2` glyph. Using a CSS mask with `background-color: currentColor` makes the icon inherit the link colour, so it correctly tracks hover, focus, and dark-mode token shifts. The SVG is inline as a data URI to avoid a network fetch and to sidestep any Iconify-plugin coupling in case Storybook or production resolves icon classes differently.

**Why `text-primary` (not `text-primary-600`):** Nuxt UI v3 exposes the resolved primary token via the `text-primary` utility (the codebase already uses this elsewhere — confirmed via `grep`). Specific shade utilities like `text-primary-600` rely on Tailwind's colour scale, which Nuxt UI v3 may map differently per theme.

- [ ] **Step 2: Eyeball in dev**

Switch back to the dev server tab. In the entry you opened in Task 2, use the toolbar:

1. Type some text, select it, click the external-link button (chain icon `i-lucide-link`), enter `https://example.com` — confirm the wrapped text shows a primary-coloured underline.
2. Type more text, select it, click the "Link to entry" button (link-2 icon, only appears if your RICHTEXT field has a non-empty `linkTargetContentTypeIds` allow-list), pick any entry — confirm the wrapped text shows the underline **plus** an inline chain icon before the text.

If your test content type doesn't have `linkTargetContentTypeIds` configured, edit the field on the content type to allow at least one target type, then save and re-open the entry.

- [ ] **Step 3: Confirm Storybook**

Run: `pnpm --filter cms test:storybook`
Expected: PASS for `AllStyledNodes`.

Optionally eyeball in `pnpm --filter cms storybook` — the `AllStyledNodes` story preloads both an external link and a cmsLink in its sample doc, so both styles should now render.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/components/rich-text-editor/RichTextEditor.vue
git commit -m "fix(rte): style cmsLink marks and external links in editor (#115)"
```

---

### Task 4: Fix toolbar button colour bindings

**Files:**

- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.vue` (template, three buttons)

- [ ] **Step 1: Add `color="neutral"` to the table button**

In `apps/cms/components/rich-text-editor/RichTextEditor.vue` template, find:

```vue
<UButton
  variant="ghost"
  size="xs"
  icon="i-lucide-table"
  @click="
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run()
  "
/>
```

Add `color="neutral"`:

```vue
<UButton
  variant="ghost"
  size="xs"
  icon="i-lucide-table"
  color="neutral"
  @click="
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run()
  "
/>
```

- [ ] **Step 2: Add `:color` binding to the external link button**

Find:

```vue
<UButton variant="ghost" size="xs" icon="i-lucide-link" @click="promptLink" />
```

Add the binding (the `Link` mark is toggleable, mirroring B/I/H):

```vue
<UButton
  variant="ghost"
  size="xs"
  icon="i-lucide-link"
  :color="editor.isActive('link') ? 'primary' : 'neutral'"
  @click="promptLink"
/>
```

- [ ] **Step 3: Add `color="neutral"` to the embed `@` button**

Find:

```vue
<UButton
  v-if="embedsEnabled"
  variant="ghost"
  size="xs"
  icon="i-lucide-at-sign"
  :data-testid="QA_RICH_TEXT_EDITOR.EMBED_BTN"
  aria-label="Insert inline embed"
  @click="openEmbedPicker"
/>
```

Add `color="neutral"`:

```vue
<UButton
  v-if="embedsEnabled"
  variant="ghost"
  size="xs"
  icon="i-lucide-at-sign"
  color="neutral"
  :data-testid="QA_RICH_TEXT_EDITOR.EMBED_BTN"
  aria-label="Insert inline embed"
  @click="openEmbedPicker"
/>
```

- [ ] **Step 4: Eyeball in dev**

Switch back to the dev server tab. With the entry editor open:

1. Confirm the table, external link, and embed `@` buttons render in the same neutral grey as the bold/italic/heading/list/blockquote/code buttons by default.
2. Click somewhere in an existing external-URL link in the body. Confirm the external link button turns primary (green) while the cursor is inside the link, and goes back to neutral when the cursor leaves it.
3. Confirm the table and embed buttons stay neutral regardless of cursor position (no toggleable active state).

- [ ] **Step 5: Confirm Storybook**

Run: `pnpm --filter cms test:storybook`
Expected: PASS for `AllStyledNodes`.

The story preloads `targetContentTypeIds` and `linkTargetContentTypeIds`, so all toolbar buttons render. If you eyeball the story in `pnpm --filter cms storybook`, every button should be neutral grey at rest.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/components/rich-text-editor/RichTextEditor.vue
git commit -m "fix(rte): correct toolbar button color bindings (#115)"
```

---

### Task 5: Final verification + push

**Files:** none

- [ ] **Step 1: Run the full project lint + typecheck + tests**

Run (in three separate commands, each surfaces its own errors clearly):

```bash
pnpm lint
pnpm typecheck
pnpm --filter cms test:storybook
```

Expected: all PASS. The integration + unit Vitest projects do not exercise this component, so this PR's changes should not affect them — but the pre-push hook will run them anyway.

- [ ] **Step 2: Check Wallaby for failing tests**

Use the `wallaby_failingTests` MCP tool. Three outcomes per `CLAUDE.md`:

- **No failures (structured empty array)** — proceed to Step 3 with `WALLABY_VERIFIED=1` prefix on the push.
- **Failures found** — stop and report to the user before pushing.
- **Wallaby unavailable / `<No data available>` / empty / null** — proceed to Step 3 with a plain `git push` (the pre-push hook runs the full test suite).

- [ ] **Step 3: Push the branch**

If Wallaby returned no failures:

```bash
WALLABY_VERIFIED=1 git push -u origin fix/rte-editor-presentation
```

Otherwise:

```bash
git push -u origin fix/rte-editor-presentation
```

Expected: push succeeds, branch is now on the remote.

- [ ] **Step 4: Open the PR**

Run:

```bash
gh pr create --title "fix(rte): editor presentation gaps (#115)" --body "$(cat <<'EOF'
## Summary

Fixes the three in-editor presentation gaps tracked in #115:

- Hand-rolled scoped typography for headings, paragraphs, lists, blockquote, and code (replaces the no-op `prose` classes — `@tailwindcss/typography` is not installed).
- `.cms-link` marks now render with primary-coloured underline + inline chain icon; plain external `<a>` marks now render with primary-coloured underline.
- Table, external link, and embed `@` toolbar buttons now bind `:color` correctly — they no longer render permanently green.
- Adds `RichTextEditor.stories.ts` as a permanent visual review surface (no automated visual assertions; manual review only).

Presentation-only — saved ProseMirror JSON, GraphQL output, and external consumer behaviour are unaffected.

Spec: \`docs/superpowers/specs/2026-04-29-rte-editor-presentation-fixes-design.md\`

## Test plan

- [ ] H1 / H2 / H3 visibly differ from body text in the entry editor
- [ ] Bullet lists, ordered lists, blockquote, and code blocks render with appropriate markers/styling
- [ ] cmsLink-wrapped text shows the chain icon + underline
- [ ] External URL links show underline only (no icon)
- [ ] Toolbar buttons B / I / H1-3 / lists / blockquote / code / cmsLink go primary green only when active
- [ ] Toolbar buttons table and embed \`@\` stay neutral grey regardless of cursor position
- [ ] External link button toggles to primary green when the cursor is inside an existing link
- [ ] \`pnpm --filter cms test:storybook\` passes for \`AllStyledNodes\`

Closes #115

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review

**Spec coverage:**

- Heading + editor-content typography (spec §Changes #1) → Task 2 ✓
- `.cms-link` mark + external-link styling (spec §Changes #2) → Task 3 ✓
- Toolbar button colour bindings (spec §Changes #3) → Task 4 ✓
- Storybook story (spec §Changes #4) → Task 1 ✓
- Verification — manual smoke test, Storybook eyeball, `pnpm test:storybook` (spec §Verification) → Tasks 2/3/4 each verify in dev + Storybook; Task 5 runs the full `test:storybook` + `lint` + `typecheck`. ✓
- Out of scope items (`@tailwindcss/typography` install, visual regression, `cmsEmbed` story coverage) → none of the tasks add these. ✓

**Placeholder scan:** No TBD/TODO. All steps include exact code + commands. ✓

**Type consistency:** Wrapper class `.rich-text-editor__content` is used identically in Task 2 (template) and Tasks 2–3 (CSS rules). Story arg names (`modelValue`, `targetContentTypeIds`, `linkTargetContentTypeIds`) match `RichTextEditor.vue`'s `defineProps`. Toolbar `color` binding strings (`'primary' | 'neutral'`) match Nuxt UI's `UButton` `color` prop type. ✓
