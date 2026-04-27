# RICHTEXT Inline Embeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the removed `CmsEmbed` Tiptap node against the dynamic `ContentEntry` layer, gated by a per-field allow-list chip picker on the RICHTEXT field definition. Closes #45.

**Architecture:** The RICHTEXT field gains an optional `options.targetContentTypeIds: string[]` JSONB value — identical in shape to RELATION/MULTIRELATION — and a reusable `ContentTypeChipPicker` component renders it in the field editor. `RichTextEditor` conditionally registers a new `cmsEmbed` Tiptap node when the prop is non-empty, shows an "Insert embed" toolbar button that opens the existing `EntryPickerModal`, and renders a Vue node view that resolves the embed via `useRelationResolver`. Server `validateEntryData` walks the ProseMirror tree and rejects any embed whose `contentTypeId` is outside the field's allow-list. `scripts/content-bundle/portable.ts` extends its data-refs walker to rewrite `cmsEmbed` refs on portable export/import.

**Tech Stack:** Nuxt 4, Vue 3, Tiptap v2 (`@tiptap/vue-3`), Prisma v7, Pothos. Spec: `docs/superpowers/specs/2026-04-24-richtext-inline-embeds-design.md`.

**Reference reading before starting:**

- The spec listed above
- `apps/cms/CLAUDE.md` — repo conventions (path aliases, auto-imports, FieldConfig pattern)
- `apps/cms/components/rich-text-editor/RichTextEditor.vue` — Tiptap setup to extend
- `apps/cms/components/entry-picker-modal/EntryPickerModal.vue` — picker we'll reuse
- `apps/cms/composables/useRelationResolver.ts` — caches `{contentTypeId, entryId}` → entryTitle
- `apps/cms/server/utils/validateEntryData.ts` — RICHTEXT case at line 103
- `apps/cms/scripts/content-bundle/portable.ts` — RELATION/MULTIRELATION walker to mirror
- `apps/cms/pages/content-types/new.vue:359-436` and `pages/content-types/[id]/index.vue:508-584` — duplicated chip block we'll extract

---

## File Structure

**New files:**

- `apps/cms/components/content-type-chip-picker/ContentTypeChipPicker.vue` — shared chip picker
- `apps/cms/components/content-type-chip-picker/contentTypeChipPicker.types.ts`
- `apps/cms/components/content-type-chip-picker/contentTypeChipPicker.config.ts`
- `apps/cms/components/rich-text-editor/extensions/CmsEmbed.ts` — Tiptap Node definition
- `apps/cms/components/rich-text-editor/CmsEmbedNodeView.vue` — Vue node view component

**Modified files:**

- `apps/cms/types/contentEditor.ts` — add `targetContentTypeIds?: string[]` to `RichtextFieldConfig`
- `apps/cms/utils/mapFieldToConfig.ts` — pass `targetContentTypeIds` through for RICHTEXT
- `apps/cms/components/rich-text-editor/richTextEditor.types.ts` — add `targetContentTypeIds?: string[]`
- `apps/cms/components/rich-text-editor/RichTextEditor.vue` — conditionally register extension, toolbar button, picker wiring
- `apps/cms/components/content-editor/ContentEditor.vue:258-267` — forward `targetContentTypeIds`
- `apps/cms/pages/content-types/new.vue` — replace inline chip block with shared component; add RICHTEXT branch
- `apps/cms/pages/content-types/[id]/index.vue` — same
- `apps/cms/server/utils/validateEntryData.ts` — walk RICHTEXT JSON, enforce allow-list on `cmsEmbed` nodes
- `apps/cms/server/utils/validateEntryData.test.ts` — new RICHTEXT embed cases
- `apps/cms/scripts/content-bundle/portable.ts` — extend `encodeDataRefs` / `decodeDataRefs` for RICHTEXT
- `apps/cms/scripts/content-bundle/portable.test.ts` — RICHTEXT embed round-trip cases
- `apps/cms/server/api/content-entries/content-entries.test.ts` — integration case: create entry with valid + invalid embed

---

## Task 1: Extend `RichtextFieldConfig` with `targetContentTypeIds`

Adding the field-config property first so later tasks compile.

**Files:**

- Modify: `apps/cms/types/contentEditor.ts:55-60`
- Modify: `apps/cms/utils/mapFieldToConfig.ts:60-65` (the `RICHTEXT` case)

- [ ] **Step 1: Add optional `targetContentTypeIds` to `RichtextFieldConfig`**

Replace the existing interface in `apps/cms/types/contentEditor.ts`:

```ts
export interface RichtextFieldConfig {
  type: 'richtext';
  key: string;
  label: string;
  targetContentTypeIds?: string[];
}
```

- [ ] **Step 2: Pass the option through in `mapFieldToConfig`**

Replace the `RICHTEXT` case in `apps/cms/utils/mapFieldToConfig.ts`:

```ts
case 'RICHTEXT': {
  const opts = field.options as {
    targetContentTypeIds?: string[];
  } | null;
  return {
    type: 'richtext',
    key: field.identifier,
    label: field.name,
    targetContentTypeIds: opts?.targetContentTypeIds ?? [],
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/types/contentEditor.ts apps/cms/utils/mapFieldToConfig.ts
git commit -m "feat(richtext): thread targetContentTypeIds through field config"
```

---

## Task 2: Extract `ContentTypeChipPicker` component

Pure refactor. The inline block is duplicated in `pages/content-types/new.vue:359-436` and `pages/content-types/[id]/index.vue:508-584`. Extract once, then swap both call sites in Task 3.

**Files:**

- Create: `apps/cms/components/content-type-chip-picker/ContentTypeChipPicker.vue`
- Create: `apps/cms/components/content-type-chip-picker/contentTypeChipPicker.types.ts`
- Create: `apps/cms/components/content-type-chip-picker/contentTypeChipPicker.config.ts`

- [ ] **Step 1: Create the types file**

Write `apps/cms/components/content-type-chip-picker/contentTypeChipPicker.types.ts`:

```ts
import type { BasicComponentProps } from '~/types/basicComponentProps';

export type ContentTypeChipPickerProps = BasicComponentProps & {
  modelValue: string[];
  options: { label: string; value: string }[] | null | undefined;
  addPlaceholder?: string;
  emptyHint?: string;
};
```

- [ ] **Step 2: Create the config file**

Write `apps/cms/components/content-type-chip-picker/contentTypeChipPicker.config.ts`:

```ts
import { testIds } from '~/utils/test-config/testConfig.utils';

export const QA_CONTENT_TYPE_CHIP_PICKER = {
  ...testIds('CONTENT_TYPE_CHIP_PICKER', {
    CHIP: 'chip',
    ADD_SELECT: 'add-select',
    EMPTY: 'empty',
  }),
};
```

**Note:** `testIds` takes the elements as an object (`{ CONSTANT_NAME: 'kebab-segment' }`), not an array. See `apps/cms/components/entry-sidebar/entrySidebar.config.ts` for a reference call site.

- [ ] **Step 3: Create the component**

Write `apps/cms/components/content-type-chip-picker/ContentTypeChipPicker.vue`:

```vue
<script setup lang="ts">
import type { ContentTypeChipPickerProps } from './contentTypeChipPicker.types';
import { QA_CONTENT_TYPE_CHIP_PICKER } from './contentTypeChipPicker.config';

const props = withDefaults(defineProps<ContentTypeChipPickerProps>(), {
  testId: QA_CONTENT_TYPE_CHIP_PICKER.COMPONENT,
  addPlaceholder: 'Add content type...',
  emptyHint: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const availableOptions = computed(() =>
  (props.options ?? []).filter((o) => !props.modelValue.includes(o.value))
);

const labelFor = (value: string) =>
  (props.options ?? []).find((o) => o.value === value)?.label ?? value;

function removeChip(value: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((v) => v !== value)
  );
}

function addChip(value: string) {
  if (!value) return;
  if (props.modelValue.includes(value)) return;
  emit('update:modelValue', [...props.modelValue, value]);
}
</script>

<template>
  <div :data-testid="testId" class="space-y-2">
    <div v-if="modelValue.length > 0" class="flex flex-wrap gap-2">
      <UBadge
        v-for="value in modelValue"
        :key="value"
        size="md"
        variant="subtle"
        color="info"
        class="cursor-pointer"
        :data-testid="QA_CONTENT_TYPE_CHIP_PICKER.CHIP"
        @click="removeChip(value)"
      >
        {{ labelFor(value) }}
        <UIcon name="i-lucide-x" class="size-3 ml-1" />
      </UBadge>
    </div>
    <p
      v-else-if="emptyHint"
      class="text-xs text-muted"
      :data-testid="QA_CONTENT_TYPE_CHIP_PICKER.EMPTY"
    >
      {{ emptyHint }}
    </p>
    <USelect
      :model-value="''"
      :items="availableOptions"
      value-key="value"
      :placeholder="addPlaceholder"
      class="w-full"
      :data-testid="QA_CONTENT_TYPE_CHIP_PICKER.ADD_SELECT"
      @update:model-value="(val: string) => addChip(val)"
    />
  </div>
</template>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/components/content-type-chip-picker/
git commit -m "feat(content-types): extract shared ContentTypeChipPicker component"
```

---

## Task 3: Replace inline chip blocks with `ContentTypeChipPicker`

Refactor-only. Verify by comparing RELATION field editor before/after — behavior must be identical.

**Files:**

- Modify: `apps/cms/pages/content-types/new.vue:359-436`
- Modify: `apps/cms/pages/content-types/[id]/index.vue:508-584`

- [ ] **Step 1: Swap the block in `pages/content-types/new.vue`**

Replace lines 359-436 (`<UFormField v-else-if="type === 'RELATION' || type === 'MULTIRELATION'" ...>` through its closing `</UFormField>`) with:

```vue
<UFormField
  v-else-if="type === 'RELATION' || type === 'MULTIRELATION'"
  label="Target Content Types"
  required
>
  <ContentTypeChipPicker
    :model-value="
      options &&
      typeof options === 'object' &&
      'targetContentTypeIds' in options
        ? (options as { targetContentTypeIds: string[] })
            .targetContentTypeIds
        : []
    "
    :options="contentTypeOptions ?? []"
    @update:model-value="
      (val: string[]) => updateOptions({ targetContentTypeIds: val })
    "
  />
</UFormField>
```

- [ ] **Step 2: Swap the block in `pages/content-types/[id]/index.vue`**

Replace lines 507-584 with the same snippet.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Manual smoke (dev server)**

Run: `pnpm dev` and visit an existing content type edit page. Open a RELATION field's edit modal.
Verify: existing chips render with labels, the "×" removes chips, the select adds new ones, and the "Save" persists the change. Repeat on the "new content type" page.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/pages/content-types/
git commit -m "refactor(content-types): use ContentTypeChipPicker for RELATION target editor"
```

---

## Task 4: Add RICHTEXT branch to the type-options slot

**Files:**

- Modify: `apps/cms/pages/content-types/new.vue` — add RICHTEXT branch
- Modify: `apps/cms/pages/content-types/[id]/index.vue` — add RICHTEXT branch

- [ ] **Step 1: Add a RICHTEXT branch after the RELATION branch in `pages/content-types/new.vue`**

Immediately after the `</UFormField>` that closes the RELATION branch (from Task 3), add:

```vue
<UFormField v-else-if="type === 'RICHTEXT'" label="Allowed inline embed types">
  <ContentTypeChipPicker
    :model-value="
      options &&
      typeof options === 'object' &&
      'targetContentTypeIds' in options
        ? (options as { targetContentTypeIds: string[] })
            .targetContentTypeIds
        : []
    "
    :options="contentTypeOptions ?? []"
    empty-hint="No inline embeds will be allowed in this field. Add a content type to enable inline embeds."
    @update:model-value="
      (val: string[]) => updateOptions({ targetContentTypeIds: val })
    "
  />
</UFormField>
```

- [ ] **Step 2: Add the same RICHTEXT branch in `pages/content-types/[id]/index.vue`**

Add the identical block immediately after the RELATION branch.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Manual smoke (dev server)**

Add a new RICHTEXT field to an existing content type; open its edit modal. Verify:

- The "Allowed inline embed types" section appears.
- Empty list shows the hint copy.
- Adding/removing content type chips persists via the field update API.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/pages/content-types/
git commit -m "feat(richtext): chip picker for allowed inline embed types in field editor"
```

---

## Task 5: Server validation — walk RICHTEXT JSON for `cmsEmbed` nodes

TDD. The RICHTEXT case currently only checks the top-level shape. Extend it with a pure walker that visits each ProseMirror node; reject any `cmsEmbed` whose `contentTypeId` is outside the field's allow-list. If the allow-list is empty/undefined, any embed is rejected.

**Files:**

- Modify: `apps/cms/server/utils/validateEntryData.test.ts`
- Modify: `apps/cms/server/utils/validateEntryData.ts:103-111`

- [ ] **Step 1: Add failing tests**

Append to `apps/cms/server/utils/validateEntryData.test.ts`:

```ts
const richtextFieldNoEmbeds = {
  identifier: 'body',
  name: 'Body',
  type: 'RICHTEXT' as const,
  required: false,
  options: null,
};

const richtextFieldWithAllowList = {
  identifier: 'body',
  name: 'Body',
  type: 'RICHTEXT' as const,
  required: false,
  options: { targetContentTypeIds: ['allowed-ct-uuid'] },
};

const doc = (content: unknown[]) => ({ type: 'doc', content });
const para = (content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string) => ({ type: 'text', text: value });
const embed = (contentTypeId: string, entryId: string) => ({
  type: 'cmsEmbed',
  attrs: { contentTypeId, entryId },
});

describe('validateEntryData — RICHTEXT embeds', () => {
  it('accepts a body with no embeds when allow-list is empty', async () => {
    const result = await validateEntryData(
      { body: doc([para([text('hello')])]) },
      [richtextFieldNoEmbeds]
    );
    expect(result.body).toEqual(doc([para([text('hello')])]));
  });

  it('rejects any embed when allow-list is empty', async () => {
    await expect(
      validateEntryData(
        {
          body: doc([para([text('hello '), embed('any-ct', 'any-entry')])]),
        },
        [richtextFieldNoEmbeds]
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('Inline embeds are not allowed'),
    });
  });

  it('accepts embed whose contentTypeId is in the allow-list', async () => {
    const value = doc([
      para([text('see '), embed('allowed-ct-uuid', 'entry-1')]),
    ]);
    const result = await validateEntryData({ body: value }, [
      richtextFieldWithAllowList,
    ]);
    expect(result.body).toEqual(value);
  });

  it('rejects embed whose contentTypeId is not in the allow-list', async () => {
    await expect(
      validateEntryData(
        { body: doc([para([embed('disallowed-ct', 'entry-1')])]) },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('not allowed for this field'),
    });
  });

  it('rejects a malformed embed node (missing attrs)', async () => {
    await expect(
      validateEntryData({ body: doc([para([{ type: 'cmsEmbed' }])]) }, [
        richtextFieldWithAllowList,
      ])
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('Invalid inline embed'),
    });
  });

  it('walks nested content (embed inside blockquote)', async () => {
    await expect(
      validateEntryData(
        {
          body: doc([
            {
              type: 'blockquote',
              content: [para([embed('disallowed-ct', 'e1')])],
            },
          ]),
        },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
```

- [ ] **Step 2: Run tests and confirm failures**

Run: `pnpm --filter cms test:unit -- validateEntryData`
Expected: the new `RICHTEXT embeds` suite fails (no walker yet — current code accepts any object).

- [ ] **Step 3: Implement the walker**

Replace the RICHTEXT case in `apps/cms/server/utils/validateEntryData.ts` (lines 103-111):

```ts
case 'RICHTEXT': {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field.name} must be a JSON object`,
    });
  }
  const rtOpts = field.options as {
    targetContentTypeIds?: string[];
  } | null;
  const allowedEmbedTypes = rtOpts?.targetContentTypeIds ?? [];
  validateRichtextEmbeds(value, allowedEmbedTypes, field.name);
  validated[field.identifier] = value;
  break;
}
```

Add the helper at the bottom of the file (before the `extractSlug` export):

```ts
/**
 * Walk a ProseMirror JSON document, asserting every `cmsEmbed` node's
 * `contentTypeId` is in the allow-list. Empty allow-list means no embeds
 * are allowed at all.
 */
function validateRichtextEmbeds(
  doc: unknown,
  allowedContentTypeIds: string[],
  fieldName: string
): void {
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: unknown; attrs?: unknown; content?: unknown };
    if (n.type === 'cmsEmbed') {
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;
      if (
        typeof attrs.contentTypeId !== 'string' ||
        typeof attrs.entryId !== 'string'
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Invalid inline embed (missing contentTypeId or entryId).`,
        });
      }
      if (allowedContentTypeIds.length === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Inline embeds are not allowed in this field.`,
        });
      }
      if (!allowedContentTypeIds.includes(attrs.contentTypeId)) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Inline embed references a content type that is not allowed for this field.`,
        });
      }
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }
  walk(doc);
}
```

- [ ] **Step 4: Run tests and confirm pass**

Run: `pnpm --filter cms test:unit -- validateEntryData`
Expected: all RICHTEXT embed tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/validateEntryData.ts apps/cms/server/utils/validateEntryData.test.ts
git commit -m "feat(richtext): enforce cmsEmbed allow-list in entry validation"
```

---

## Task 6: Portable round-trip for `cmsEmbed` nodes

TDD. The existing `encodeDataRefs` / `decodeDataRefs` walk top-level RELATION / MULTIRELATION values. Extend them with a RICHTEXT branch that walks the ProseMirror JSON and rewrites `cmsEmbed` `attrs` identically to how RELATION refs are handled.

**Note:** The field's own `options.targetContentTypeIds` is already handled by `scripts/content-bundle/export.ts:60-92` + `import.ts:94-168` (both iterate any field with `Array.isArray(options.targetContentTypeIds)` and rewrite to/from identifiers). So RICHTEXT's allow-list option already round-trips for free — this task only covers the `cmsEmbed` node attrs inside the JSON body.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/portable.test.ts`
- Modify: `apps/cms/scripts/content-bundle/portable.ts`

- [ ] **Step 1: Add failing round-trip tests**

Append to `apps/cms/scripts/content-bundle/portable.test.ts`:

```ts
describe('encode/decodeDataRefs — RICHTEXT embeds', () => {
  const fieldTypes = { body: 'RICHTEXT' as const };
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'see ' },
          {
            type: 'cmsEmbed',
            attrs: { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
          },
        ],
      },
    ],
  };

  it('encodes embed attrs to portable identifier/key', () => {
    const out = encodeDataRefs(
      { body: doc },
      fieldTypes,
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    const embed = (out.body as any).content[0].content[1];
    expect(embed.attrs).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });
  });

  it('decodes portable embed attrs back to uuid form', () => {
    const portableDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'cmsEmbed',
              attrs: {
                contentTypeIdentifier: 'BlogPost',
                entryKey: 'hello',
              },
            },
          ],
        },
      ],
    };
    const out = decodeDataRefs(
      { body: portableDoc },
      fieldTypes,
      identToTypeId,
      typeIdentToKeyToEntry
    );
    const embed = (out.body as any).content[0].content[0];
    expect(embed.attrs).toEqual({
      contentTypeId: 'aaa-uuid-ct',
      entryId: 'post-uuid-1',
    });
  });

  it('passes through RICHTEXT values with no embeds untouched', () => {
    const plain = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    };
    const out = encodeDataRefs(
      { body: plain },
      fieldTypes,
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    expect(out.body).toEqual(plain);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter cms test:unit -- portable`
Expected: the new suite fails (RICHTEXT isn't a recognized branch yet; current code falls through to the passthrough `else`).

- [ ] **Step 3: Implement the walker in `portable.ts`**

Add helpers after the existing `decodeRelationRef` function:

```ts
function mapCmsEmbedAttrs(
  node: unknown,
  encode: (attrs: Record<string, unknown>) => Record<string, unknown>
): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as { type?: unknown; attrs?: unknown; content?: unknown };
  const next: Record<string, unknown> = { ...(n as object) } as Record<
    string,
    unknown
  >;
  if (n.type === 'cmsEmbed') {
    next.attrs = encode((n.attrs ?? {}) as Record<string, unknown>);
  }
  if (Array.isArray(n.content)) {
    next.content = n.content.map((c) => mapCmsEmbedAttrs(c, encode));
  }
  return next;
}

export function encodeRichtextRefs(
  value: unknown,
  typeIdToIdentifier: Map<string, string>,
  typeIdentifierToEntryKeys: Map<string, EntryKeyMap>
): unknown {
  return mapCmsEmbedAttrs(value, (attrs) => {
    const ref = encodeRelationRef(
      {
        contentTypeId: attrs.contentTypeId as string,
        entryId: attrs.entryId as string,
      },
      typeIdToIdentifier,
      typeIdentifierToEntryKeys
    );
    return {
      contentTypeIdentifier: ref.contentTypeIdentifier,
      entryKey: ref.entryKey,
    };
  });
}

export function decodeRichtextRefs(
  value: unknown,
  identifierToTypeId: Map<string, string>,
  typeIdentifierToKeyToEntry: Map<string, Map<string, string>>
): unknown {
  return mapCmsEmbedAttrs(value, (attrs) => {
    const uuid = decodeRelationRef(
      {
        contentTypeIdentifier: attrs.contentTypeIdentifier as string,
        entryKey: attrs.entryKey as string,
      },
      identifierToTypeId,
      typeIdentifierToKeyToEntry
    );
    return { contentTypeId: uuid.contentTypeId, entryId: uuid.entryId };
  });
}
```

Then wire them into the top-level walkers. Replace the `else` in `encodeDataRefs` (current line 91-93) with:

```ts
} else if (type === 'RICHTEXT') {
  out[key] = encodeRichtextRefs(
    value,
    typeIdToIdentifier,
    typeIdentifierToEntryKeys
  );
} else {
  out[key] = value;
}
```

And the corresponding `else` in `decodeDataRefs` (current line 121-123):

```ts
} else if (type === 'RICHTEXT') {
  out[key] = decodeRichtextRefs(
    value,
    identifierToTypeId,
    typeIdentifierToKeyToEntry
  );
} else {
  out[key] = value;
}
```

- [ ] **Step 4: Run tests and confirm pass**

Run: `pnpm --filter cms test:unit -- portable`
Expected: all `encode/decodeDataRefs — RICHTEXT embeds` tests pass, existing cases still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/portable.ts apps/cms/scripts/content-bundle/portable.test.ts
git commit -m "feat(content-bundle): rewrite cmsEmbed refs in portable round-trip"
```

---

## Task 7: Tiptap `CmsEmbed` node + Vue node view

**Files:**

- Create: `apps/cms/components/rich-text-editor/extensions/CmsEmbed.ts`
- Create: `apps/cms/components/rich-text-editor/CmsEmbedNodeView.vue`

- [ ] **Step 1: Create the Tiptap node**

Write `apps/cms/components/rich-text-editor/extensions/CmsEmbed.ts`:

```ts
import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CmsEmbedNodeView from '../CmsEmbedNodeView.vue';

export interface CmsEmbedAttrs {
  contentTypeId: string | null;
  entryId: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cmsEmbed: {
      insertCmsEmbed: (attrs: {
        contentTypeId: string;
        entryId: string;
      }) => ReturnType;
    };
  }
}

export const CmsEmbed = Node.create({
  name: 'cmsEmbed',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      contentTypeId: { default: null },
      entryId: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-cms-embed]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return {
            contentTypeId: el.getAttribute('data-content-type-id'),
            entryId: el.getAttribute('data-entry-id'),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-cms-embed': '',
        'data-content-type-id': HTMLAttributes.contentTypeId ?? '',
        'data-entry-id': HTMLAttributes.entryId ?? '',
      }),
    ];
  },

  addCommands() {
    return {
      insertCmsEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: 'cmsEmbed', attrs }),
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(CmsEmbedNodeView);
  },
});
```

- [ ] **Step 2: Create the Vue node view**

Write `apps/cms/components/rich-text-editor/CmsEmbedNodeView.vue`:

```vue
<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3';
import type { NodeViewProps } from '@tiptap/core';

const props = defineProps<NodeViewProps>();

const { resolveRef } = useRelationResolver();

const resolved = ref<{
  entryTitle: string;
  contentTypeName: string;
} | null>(null);
const missing = ref(false);

async function load() {
  const contentTypeId = props.node.attrs.contentTypeId as string | null;
  const entryId = props.node.attrs.entryId as string | null;
  if (!contentTypeId || !entryId) {
    missing.value = true;
    return;
  }
  try {
    const r = await resolveRef({ contentTypeId, entryId });
    resolved.value = {
      entryTitle: r.entryTitle,
      contentTypeName: r.contentTypeName,
    };
    missing.value = false;
  } catch {
    missing.value = true;
  }
}

watch(
  () => [props.node.attrs.contentTypeId, props.node.attrs.entryId],
  () => {
    void load();
  },
  { immediate: true }
);
</script>

<template>
  <NodeViewWrapper
    as="span"
    class="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm align-baseline cursor-default"
  >
    <template v-if="missing">
      <UIcon name="i-lucide-link-2-off" class="size-3 text-red-500" />
      <span class="italic text-muted">(deleted)</span>
    </template>
    <template v-else-if="resolved">
      <UBadge
        size="sm"
        color="neutral"
        variant="subtle"
        class="text-[10px] px-1"
      >
        {{ resolved.contentTypeName }}
      </UBadge>
      <span>{{ resolved.entryTitle }}</span>
    </template>
    <template v-else>
      <UIcon name="i-lucide-loader-2" class="size-3 animate-spin text-muted" />
    </template>
  </NodeViewWrapper>
</template>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors. If Tiptap complains about `NodeViewProps`, re-check the import path matches the installed `@tiptap/vue-3` version (found in `apps/cms/package.json`).

- [ ] **Step 4: Commit**

```bash
git add apps/cms/components/rich-text-editor/extensions/ apps/cms/components/rich-text-editor/CmsEmbedNodeView.vue
git commit -m "feat(richtext): CmsEmbed Tiptap node + Vue node view"
```

---

## Task 8: Wire `RichTextEditor` to conditionally use `CmsEmbed` + picker

**Files:**

- Modify: `apps/cms/components/rich-text-editor/richTextEditor.types.ts`
- Modify: `apps/cms/components/rich-text-editor/richTextEditor.config.ts`
- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.vue`
- Modify: `apps/cms/components/content-editor/ContentEditor.vue:258-267`

- [ ] **Step 1: Extend the editor props**

Replace `apps/cms/components/rich-text-editor/richTextEditor.types.ts`:

```ts
import type { BasicComponentProps } from '~/types/basicComponentProps';

export type RichTextEditorProps = BasicComponentProps & {
  modelValue: unknown;
  targetContentTypeIds?: string[];
};
```

- [ ] **Step 2: Add an EMBED_BTN test id**

Replace `apps/cms/components/rich-text-editor/richTextEditor.config.ts`:

```ts
import { testIds } from '~/utils/test-config/testConfig.utils';

export const QA_RICH_TEXT_EDITOR = {
  ...testIds('RICH_TEXT_EDITOR', {
    EMBED_BTN: 'embed-btn',
  }),
};
```

- [ ] **Step 3: Update `RichTextEditor.vue` — extensions, toolbar, picker**

Replace `apps/cms/components/rich-text-editor/RichTextEditor.vue`:

```vue
<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { CmsEmbed } from './extensions/CmsEmbed';
import type { RichTextEditorProps } from './richTextEditor.types';
import { QA_RICH_TEXT_EDITOR } from './richTextEditor.config';

const props = withDefaults(defineProps<RichTextEditorProps>(), {
  testId: QA_RICH_TEXT_EDITOR.COMPONENT,
  targetContentTypeIds: () => [],
});

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
}>();

const lowlight = createLowlight(common);

const embedsEnabled = computed(
  () => (props.targetContentTypeIds?.length ?? 0) > 0
);

const extensions = computed(() => {
  const base = [
    StarterKit.configure({ codeBlock: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    Link.configure({ openOnClick: false }),
    Image,
    CodeBlockLowlight.configure({ lowlight }),
  ];
  return embedsEnabled.value ? [...base, CmsEmbed] : base;
});

const editor = useEditor({
  extensions: extensions.value,
  content: props.modelValue as Record<string, unknown> | null,
  onUpdate: ({ editor: e }) => {
    emit('update:modelValue', e.getJSON());
  },
});

watch(
  () => props.modelValue,
  (val) => {
    if (!editor.value) return;
    const currentJson = JSON.stringify(editor.value.getJSON());
    const newJson = JSON.stringify(val);
    if (currentJson !== newJson) {
      editor.value.commands.setContent(val as Record<string, unknown> | null);
    }
  }
);

function promptLink() {
  if (!editor.value) return;
  const url = window.prompt('URL');
  if (url) editor.value.chain().focus().setLink({ href: url }).run();
}

const pickerOpen = ref(false);
function openEmbedPicker() {
  pickerOpen.value = true;
}
function handleEmbedSelect(data: {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
}) {
  if (!editor.value) return;
  editor.value
    .chain()
    .focus()
    .insertContent({
      type: 'cmsEmbed',
      attrs: { contentTypeId: data.contentTypeId, entryId: data.entryId },
    })
    .run();
  pickerOpen.value = false;
}

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<template>
  <div class="border rounded-lg overflow-hidden" :data-testid="testId">
    <div
      v-if="editor"
      class="flex flex-wrap gap-1 p-2 border-b bg-gray-50 dark:bg-gray-900"
    >
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-bold"
        :color="editor.isActive('bold') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleBold().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-italic"
        :color="editor.isActive('italic') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleItalic().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-heading-1"
        :color="
          editor.isActive('heading', { level: 1 }) ? 'primary' : 'neutral'
        "
        @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-heading-2"
        :color="
          editor.isActive('heading', { level: 2 }) ? 'primary' : 'neutral'
        "
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-heading-3"
        :color="
          editor.isActive('heading', { level: 3 }) ? 'primary' : 'neutral'
        "
        @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-list"
        :color="editor.isActive('bulletList') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleBulletList().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-list-ordered"
        :color="editor.isActive('orderedList') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleOrderedList().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-quote"
        :color="editor.isActive('blockquote') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleBlockquote().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-code"
        :color="editor.isActive('codeBlock') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleCodeBlock().run()"
      />
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
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-link"
        @click="promptLink"
      />
      <UButton
        v-if="embedsEnabled"
        variant="ghost"
        size="xs"
        icon="i-lucide-at-sign"
        :data-testid="QA_RICH_TEXT_EDITOR.EMBED_BTN"
        aria-label="Insert inline embed"
        @click="openEmbedPicker"
      />
    </div>

    <EditorContent
      :editor="editor"
      class="prose dark:prose-invert max-w-none p-4 min-h-[200px]"
    />

    <EntryPickerModal
      v-if="embedsEnabled"
      :open="pickerOpen"
      :target-content-type-ids="targetContentTypeIds"
      @select="handleEmbedSelect"
      @close="pickerOpen = false"
    />
  </div>
</template>
```

- [ ] **Step 4: Forward the prop from `ContentEditor.vue`**

Replace lines 257-267 in `apps/cms/components/content-editor/ContentEditor.vue`:

```vue
<UFormField
  v-else-if="field.type === 'richtext'"
  :label="field.label"
  :name="field.key"
  size="xl"
>
  <RichTextEditor
    :model-value="state[field.key]"
    :target-content-type-ids="field.targetContentTypeIds ?? []"
    @update:model-value="state[field.key] = $event"
  />
</UFormField>
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no new errors.

- [ ] **Step 6: Manual smoke (dev server)**

Run: `pnpm dev`. Create / edit a content type with a RICHTEXT field; leave the allow-list empty. Verify on an entry for that type that the RichTextEditor does **not** show the "@" toolbar button and pasting an embed HTML fragment has no effect (the node isn't registered).

Then set the allow-list to include one content type. Reload the entry and verify:

- The "@" button appears.
- Clicking it opens the entry picker filtered to the allow-listed types.
- Picking an entry inserts a pill showing `{ContentTypeName} {entryTitle}`.
- Saving the entry persists the JSON; reloading renders the pill on the fly.

- [ ] **Step 7: Commit**

```bash
git add apps/cms/components/rich-text-editor/ apps/cms/components/content-editor/ContentEditor.vue
git commit -m "feat(richtext): inline embed picker + node view in RichTextEditor"
```

---

## Task 9: Integration test — entry save with and without allowed embed

**Files:**

- Modify: `apps/cms/server/api/content-entries/content-entries.test.ts`

- [ ] **Step 1: Add failing tests**

The existing file uses Prisma directly for setup and raw `fetch` with a cookie header for auth (see the `getSessionCookie()` helper at the top of the file and the pattern at `POST /api/content-entries` line 130). Follow that pattern.

Append a new `describe` block at the bottom of `apps/cms/server/api/content-entries/content-entries.test.ts`:

```ts
describe('RICHTEXT inline embeds', () => {
  let targetCt: { id: string };
  let otherCt: { id: string };
  let hostCt: { id: string };
  let targetEntryId: string;
  let otherEntryId: string;

  beforeAll(async () => {
    targetCt = await prisma.contentType.create({
      data: {
        identifier: 'EmbedNote',
        name: 'EmbedNote',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              order: 0,
              required: true,
              unique: true,
            },
          ],
        },
      },
    });
    otherCt = await prisma.contentType.create({
      data: {
        identifier: 'EmbedOther',
        name: 'EmbedOther',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              order: 0,
              required: true,
              unique: true,
            },
          ],
        },
      },
    });
    hostCt = await prisma.contentType.create({
      data: {
        identifier: 'EmbedHost',
        name: 'EmbedHost',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              order: 0,
              required: true,
              unique: true,
            },
            {
              identifier: 'body',
              name: 'Body',
              type: 'RICHTEXT',
              order: 1,
              required: false,
              unique: false,
              options: { targetContentTypeIds: [targetCt.id] },
            },
          ],
        },
      },
    });

    const targetEntry = await prisma.contentEntry.create({
      data: {
        contentTypeId: targetCt.id,
        entryTitle: 'EmbedTarget',
        slug: null,
        versions: {
          create: {
            status: 'DRAFT',
            entryTitle: 'EmbedTarget',
            data: { title: 'EmbedTarget' },
          },
        },
      },
    });
    targetEntryId = targetEntry.id;

    const otherEntry = await prisma.contentEntry.create({
      data: {
        contentTypeId: otherCt.id,
        entryTitle: 'EmbedOtherEntry',
        slug: null,
        versions: {
          create: {
            status: 'DRAFT',
            entryTitle: 'EmbedOtherEntry',
            data: { title: 'EmbedOtherEntry' },
          },
        },
      },
    });
    otherEntryId = otherEntry.id;
  });

  it('accepts a body with an embed whose contentTypeId is in the allow-list', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: hostCt.id,
        data: {
          title: 'HostAllowed',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'see ' },
                  {
                    type: 'cmsEmbed',
                    attrs: {
                      contentTypeId: targetCt.id,
                      entryId: targetEntryId,
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects an embed whose contentTypeId is not in the allow-list', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: hostCt.id,
        data: {
          title: 'HostDisallowed',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'cmsEmbed',
                    attrs: {
                      contentTypeId: otherCt.id,
                      entryId: otherEntryId,
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests and confirm**

Run: `pnpm --filter cms test:integration -- content-entries`
Expected: both new tests pass. Existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/server/api/content-entries/content-entries.test.ts
git commit -m "test(richtext): integration coverage for inline embed allow-list"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: green.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Bundle round-trip smoke test**

From repo root, with dev server off and DB seeded:

```bash
pnpm --filter cms prisma:seed
pnpm content:export --all --portable --out /tmp/roundtrip.boject.json
pnpm content:validate /tmp/roundtrip.boject.json
```

Expected: validate prints OK. If you previously saved an entry with an embed, inspect the JSON and confirm `cmsEmbed` nodes carry `{ contentTypeIdentifier, entryKey }` instead of uuids.

- [ ] **Step 4: Manual smoke (end-to-end)**

Start dev server, create an Article + Note content type (Article has RICHTEXT `body` with Note in its allow-list), create a Note entry, create an Article entry and insert an inline embed of the Note — save, reload, confirm the pill renders. Delete the allow-list entry for Note and confirm: on **reopen** the body still renders the pill (non-retroactive); on **save** the request returns 400 with the "not allowed for this field" message.

- [ ] **Step 5: Final commit + PR**

If tests are green:

```bash
git log main..HEAD --oneline
```

Open a PR with a body that links the spec and #45.
