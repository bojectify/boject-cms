<script setup lang="ts">
import { basicSetup } from 'codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { jsonFieldValueError } from '~/utils/jsonFieldValue';
import type { JsonFieldProps, JsonFieldValue } from './jsonField.types';
import { QA_JSON_FIELD } from './jsonField.config';

const props = withDefaults(defineProps<JsonFieldProps>(), {
  testId: QA_JSON_FIELD.COMPONENT,
  label: undefined,
  required: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: JsonFieldValue];
  'update:error': [message: string | null];
}>();

const host = useTemplateRef<HTMLDivElement>('host');
const error = ref<string | null>(null);
let view: EditorView | null = null;
// Serialised form of the last value this component emitted, so an echo of
// our own emission back through `modelValue` doesn't reset the cursor.
let lastEmitted: string | undefined;

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

function setError(message: string | null): void {
  error.value = message;
  emit('update:error', message);
}

function onTextChange(text: string): void {
  if (text.trim() === '') {
    lastEmitted = toText(null);
    setError(null);
    emit('update:modelValue', null);
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    setError(`Invalid JSON: ${(e as Error).message}`);
    return;
  }
  const ruleError = jsonFieldValueError(parsed);
  if (ruleError) {
    setError(`Value ${ruleError}`);
    return;
  }
  lastEmitted = toText(parsed);
  setError(null);
  emit('update:modelValue', parsed as JsonFieldValue);
}

// Editor chrome follows Nuxt UI's colour tokens, so light/dark switch with
// the app's colour mode without JS. Token colours come from the `tok-*`
// classes (classHighlighter) styled below.
const theme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--ui-bg)',
    color: 'var(--ui-text)',
    fontSize: '0.875rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
  '.cm-gutters': {
    backgroundColor: 'var(--ui-bg-muted)',
    color: 'var(--ui-text-dimmed)',
    borderRight: '1px solid var(--ui-border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--ui-bg-elevated)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--ui-text)' },
});

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    doc: toText(props.modelValue),
    extensions: [
      basicSetup,
      json(),
      syntaxHighlighting(classHighlighter),
      theme,
      EditorView.contentAttributes.of({
        ...(props.label ? { 'aria-label': props.label } : {}),
        ...(props.required ? { 'aria-required': 'true' } : {}),
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onTextChange(update.state.doc.toString());
      }),
    ],
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return;
    const text = toText(value);
    if (text === lastEmitted) return;
    lastEmitted = text;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  },
  { deep: true }
);

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
  // The parent keeps per-field errors across remounts (e.g. the form hides
  // behind a loading spinner on refresh / Discard changes). A fresh mount shows
  // the stored value, so drop any error from the discarded text.
  if (error.value !== null) emit('update:error', null);
});
</script>

<template>
  <div :data-testid="testId" class="w-full">
    <div
      ref="host"
      :data-testid="QA_JSON_FIELD.EDITOR"
      class="json-field-editor overflow-hidden rounded-md border"
      :class="error ? 'border-error' : 'border-default'"
    />
    <p
      v-if="error"
      :data-testid="QA_JSON_FIELD.ERROR"
      class="mt-2 text-sm text-error"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.json-field-editor :deep(.tok-propertyName) {
  color: var(--ui-primary);
}
.json-field-editor :deep(.tok-string) {
  color: var(--ui-success);
}
.json-field-editor :deep(.tok-number) {
  color: var(--ui-warning);
}
.json-field-editor :deep(.tok-bool),
.json-field-editor :deep(.tok-null),
.json-field-editor :deep(.tok-keyword) {
  color: var(--ui-info);
}
</style>
