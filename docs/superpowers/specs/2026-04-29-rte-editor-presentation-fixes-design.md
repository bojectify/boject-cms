# RTE editor presentation fixes (issue #115)

Fix three UX gaps in the in-editor presentation of the rich text editor:

1. Headings (H1/H2/H3) render at body-text size.
2. `cmsLink` marks are visually identical to plain text.
3. Three toolbar buttons (table, external link, embed `@`) lack `:color` bindings and render permanently green, looking active when they aren't.

All saved ProseMirror JSON, GraphQL output, and external consumer behaviour are unaffected — this is a presentation-only PR. Tagged `priority: 1, show stopper` on milestone `0.0.1-rc.1`.

## Architecture

All four changes (three fixes plus a Storybook story for future visual review) land in the existing `apps/cms/components/rich-text-editor/` directory:

- Markup edits to `RichTextEditor.vue` (template).
- Presentation rules in a new `<style scoped>` block in the same SFC.
- New `RichTextEditor.stories.ts` colocated next to the component.

No new dependencies, no schema changes, no server changes, no new utility files. The `prose` / `dark:prose-invert` classes currently on `<EditorContent>` are no-ops because `@tailwindcss/typography` is not installed; we replace them with a hand-rolled scoped stylesheet rather than installing the plugin so the editor's typography stays surgical and doesn't fight our custom marks (cmsLink, external link, future cmsEmbed styling) with `prose-a` / `prose-table` defaults.

## Changes

### 1. Heading + editor-content typography

In `RichTextEditor.vue`:

- Replace `class="prose dark:prose-invert max-w-none p-4 min-h-[200px]"` on `<EditorContent>` with `class="rich-text-editor__content p-4 min-h-[200px]"`.
- Add a scoped `<style>` block defining typography under `.rich-text-editor__content`:
  - `h1`: large display weight + size, top + bottom margin.
  - `h2`: medium display.
  - `h3`: small display.
  - `p`: standard paragraph margin.
  - `ul`, `ol`: left padding + appropriate `list-style`.
  - `blockquote`: left border + muted text colour.
  - `code` (inline): mono font + subtle background.
  - `pre` (code block): mono font + block background + padding.

Tailwind v4 `@apply` is available inside scoped styles, so rules use Tailwind tokens (`@apply text-3xl font-bold mt-6 mb-2;` etc.) to align with the rest of the UI's spacing/colour scale. Vue SFC scoped CSS auto-namespaces via `data-v-…`, so these rules cannot bleed beyond the editor.

### 2. `.cms-link` mark + external-link styling

Add scoped rules for descendants of `.rich-text-editor__content`:

- `a` (any link, applies to external `Link` mark) — primary colour + underline.
- `a.cms-link` — same as `a`, plus an inline chain icon rendered via a CSS mask using a Lucide icon (consistent with the toolbar's `i-lucide-link-2` button), positioned `::before` the wrapped text. Keeps the visual idiom consistent with the rest of the UI's iconography rather than relying on emoji rendering.

This intentionally also styles plain external `<a>` elements inside the editor — they currently render as unstyled text. Without this, cmsLink (with its chain icon) would be the only link variant that's visible at all, which would feel like cmsLink was the "default" link form. Editors get a clear visual difference: plain underline = external URL, underline + chain icon = linked CMS entry.

### 3. Toolbar button colour bindings

In `RichTextEditor.vue` template:

- Table button (currently around l.211): add `color="neutral"` (insert action — no toggleable active state).
- External link button (currently around l.223): add `:color="editor.isActive('link') ? 'primary' : 'neutral'"` (the `Link` mark _is_ toggleable, mirroring the existing B/I/H pattern).
- Embed `@` button (currently around l.230): add `color="neutral"` (insert action — no toggleable active state).

The cmsLink button (l.240) already has its `:color` binding from the `feat/richtext-references` branch and is left untouched.

### 4. Storybook story

Add `RichTextEditor.stories.ts` next to the component with a single story `AllStyledNodes`:

- Preloaded `modelValue` is a ProseMirror doc that includes one of every styled node and mark covered by this PR: an H1, H2, H3, paragraph, bullet list, ordered list, blockquote, code block, an external `Link` mark, and a `cmsLink` mark.
- Passes non-empty `targetContentTypeIds` and `linkTargetContentTypeIds` so every toolbar button renders and its colour can be eyeballed.
- **Excludes the `cmsEmbed` node** because its node view (`CmsEmbedNodeView.vue`) calls `useRelationResolver` → `useRequestFetch()`, which is a Nuxt-only auto-import. The Storybook README explicitly flags Nuxt auto-imports as not yet shimmed, so including a `cmsEmbed` node would crash the story on mount. The cmsEmbed pill is unrelated to issue #115 and already renders correctly in dev.
- **No `play` function**: no user interaction means the `useToast` (cmsLink-without-selection warning) and `EntryPickerModal` (`/api/content-entries` fetch) code paths never execute. No MSW handlers or import shims are needed beyond what global Storybook config already provides.

The story is a manual visual review surface, not an automated check. It is not a CI gate for visual styling — the project's Storybook test setup runs interaction tests in browser mode, not visual regression. Its value is letting a human (now or in future RTE work) see every styled node side-by-side without having to spin up a content type and entry in the dev server. `pnpm test:storybook` will still run it headlessly, which catches the narrower regression of a future change crashing the editor on mount.

## Verification

This PR is presentation-only. No new Vitest assertions add real value — asserting "h1 is bigger than p" via queried `getComputedStyle` is brittle, and Nuxt UI button colour state isn't a stable DOM contract.

- **Manual smoke test in `pnpm dev`** — open an entry with a RICHTEXT field. Confirm:
  - H1/H2/H3 visibly differ from each other and from body text.
  - A wrapped `cmsLink` shows the chain icon + underline; an external URL link shows underline only.
  - Each toolbar button is grey/neutral by default; B/I/H/list/blockquote/code/cmsLink go green when their corresponding mark/node is active; table, external link, and embed `@` no longer render permanently green.
- **Storybook** — `pnpm storybook`, open the new `AllStyledNodes` story, eyeball that every node renders correctly.
- **`pnpm test:storybook`** — runs the story headlessly. Confirms the editor at least mounts with the preloaded doc.

## Out of scope

- Installing `@tailwindcss/typography`. Considered and rejected — see Architecture rationale.
- Adding visual regression coverage (Chromatic / Percy / image snapshots). Not currently in the project, and adding it for a P1 cosmetic bug would balloon the PR.
- Storybook coverage of the `cmsEmbed` node view, the entry picker flow, or `useToast` warning paths. Requires Nuxt auto-import shimming work that the Storybook README flags as not-yet-set-up; tracked separately if/when needed.
- Any change to saved ProseMirror JSON, GraphQL output, server validation, or external consumer behaviour.
