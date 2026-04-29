<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { CmsEmbed } from './extensions/CmsEmbed';
import { CmsLink } from './extensions/CmsLink';
import { ExternalLink } from './extensions/ExternalLink';
import type { RichTextEditorProps } from './richTextEditor.types';
import { QA_RICH_TEXT_EDITOR } from './richTextEditor.config';

const props = withDefaults(defineProps<RichTextEditorProps>(), {
  testId: QA_RICH_TEXT_EDITOR.COMPONENT,
  targetContentTypeIds: () => [],
  linkTargetContentTypeIds: () => [],
});

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
}>();

const lowlight = createLowlight(common);

const embedsEnabled = computed(
  () => (props.targetContentTypeIds?.length ?? 0) > 0
);

const cmsLinksEnabled = computed(
  () => (props.linkTargetContentTypeIds?.length ?? 0) > 0
);

// Intentionally read once at editor creation; allow-list changes
// mid-session would not hot-reconfigure the editor.
const extensions = computed(() => {
  const base = [
    StarterKit.configure({ codeBlock: false, link: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    ExternalLink,
    Image,
    CodeBlockLowlight.configure({ lowlight }),
  ];
  const withEmbed = embedsEnabled.value ? [...base, CmsEmbed] : base;
  return cmsLinksEnabled.value ? [...withEmbed, CmsLink] : withEmbed;
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

const linkPickerOpen = ref(false);
function openCmsLinkPicker() {
  if (!editor.value) return;
  // Require a non-empty selection so we have text to wrap.
  const { from, to } = editor.value.state.selection;
  if (from === to) {
    useToast().add({
      title: 'Select some text to turn into an entry link.',
      color: 'warning',
    });
    return;
  }
  linkPickerOpen.value = true;
}
function handleCmsLinkSelect(data: { contentTypeId: string; entryId: string }) {
  if (!editor.value) return;
  // TODO: Task 9 wires up the new insert flow
  // editor.value
  //   .chain()
  //   .focus()
  //   .setCmsLink({
  //     contentTypeId: data.contentTypeId,
  //     entryId: data.entryId,
  //   })
  //   .run();
  void data;
  linkPickerOpen.value = false;
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
        color="neutral"
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
        :color="editor.isActive('link') ? 'primary' : 'neutral'"
        @click="promptLink"
      />
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
      <UButton
        v-if="cmsLinksEnabled"
        variant="ghost"
        size="xs"
        icon="i-lucide-link-2"
        :color="editor?.isActive('cmsLink') ? 'primary' : 'neutral'"
        :data-testid="QA_RICH_TEXT_EDITOR.CMS_LINK_BTN"
        aria-label="Link to entry"
        @click="openCmsLinkPicker"
      />
    </div>

    <EditorContent
      :editor="editor"
      class="rich-text-editor__content p-4 min-h-[200px]"
    />

    <EntryPickerModal
      v-if="pickerOpen"
      :open="pickerOpen"
      :target-content-type-ids="targetContentTypeIds"
      @select="handleEmbedSelect"
      @close="pickerOpen = false"
    />

    <EntryPickerModal
      v-if="linkPickerOpen"
      :open="linkPickerOpen"
      :target-content-type-ids="linkTargetContentTypeIds"
      @select="handleCmsLinkSelect"
      @close="linkPickerOpen = false"
    />
  </div>
</template>

<!--
  Hand-rolled editor typography. We deliberately don't use Tailwind's `prose`
  classes — `@tailwindcss/typography` is not installed, and re-adding it
  cascades aggressive defaults onto custom marks (cmsLink, cmsEmbed) and
  toolbar chrome. Keep these rules anchored on `.rich-text-editor__content`.
-->
<style scoped>
@reference '~/assets/css/main.css';

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
.rich-text-editor__content :deep(.rich-text-editor__chip) {
  @apply inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md text-sm cursor-pointer transition-colors align-baseline;
  background-color: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.rich-text-editor__content :deep(.rich-text-editor__chip:hover) {
  background-color: rgba(0, 0, 0, 0.08);
}
.rich-text-editor__content :deep(.rich-text-editor__chip--selected) {
  @apply ring-2 ring-primary ring-offset-1;
}
.rich-text-editor__content :deep(.rich-text-editor__chip-icon) {
  @apply size-3.5 shrink-0;
}
.rich-text-editor__content :deep(.rich-text-editor__chip-label) {
  @apply truncate max-w-xs;
}
.rich-text-editor__content
  :deep(.rich-text-editor__chip--embed .rich-text-editor__chip-icon),
.rich-text-editor__content
  :deep(.rich-text-editor__chip--link .rich-text-editor__chip-icon) {
  @apply text-primary;
}
.rich-text-editor__content
  :deep(.rich-text-editor__chip--external .rich-text-editor__chip-icon) {
  @apply text-amber-600 dark:text-amber-400;
}
</style>
