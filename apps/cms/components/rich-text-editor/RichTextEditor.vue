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

// Intentionally read once at editor creation; allow-list changes
// mid-session would not hot-reconfigure the editor.
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
      v-if="pickerOpen"
      :open="pickerOpen"
      :target-content-type-ids="targetContentTypeIds"
      @select="handleEmbedSelect"
      @close="pickerOpen = false"
    />
  </div>
</template>
