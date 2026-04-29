<script setup lang="ts">
import type {
  ExternalLinkModalProps,
  ExternalLinkSavePayload,
} from './externalLinkModal.types';
import type { LinkOptions } from '~/components/link-options-form/linkOptionsForm.types';
import { QA_EXTERNAL_LINK_MODAL } from './externalLinkModal.config';

const props = withDefaults(defineProps<ExternalLinkModalProps>(), {
  testId: QA_EXTERNAL_LINK_MODAL.COMPONENT,
  initialHref: '',
  initialOptions: () => ({ label: '', target: null, rel: null }),
});

const emit = defineEmits<{
  save: [payload: ExternalLinkSavePayload];
  remove: [];
  close: [];
}>();

const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

const href = ref(props.initialHref);
const options = ref<LinkOptions>({ ...props.initialOptions });

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      href.value = props.initialHref;
      options.value = { ...props.initialOptions };
    }
  }
);

const validation = computed<{ ok: boolean; message: string | null }>(() => {
  const trimmed = href.value.trim();
  if (trimmed === '') return { ok: false, message: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: 'Enter a valid URL.' };
  }
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return {
      ok: false,
      message: `Scheme '${parsed.protocol}' is not allowed.`,
    };
  }
  if (
    (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') &&
    parsed.pathname.trim() === ''
  ) {
    return {
      ok: false,
      message: `${parsed.protocol.replace(':', '')} target is missing.`,
    };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return {
      ok: false,
      message: 'URL must not embed credentials.',
    };
  }
  return { ok: true, message: null };
});

function onSave() {
  if (!validation.value.ok) return;
  emit('save', { href: href.value.trim(), ...options.value });
}
</script>

<template>
  <UModal
    :data-testid="testId"
    :open="open"
    @update:open="
      (val: boolean) => {
        if (!val) emit('close');
      }
    "
  >
    <template #header>
      <h3 class="text-lg font-semibold">
        {{ mode === 'insert' ? 'Insert link' : 'Edit link' }}
      </h3>
    </template>

    <template #body>
      <div class="space-y-4">
        <UFormField label="URL" :error="validation.message ?? undefined">
          <UInput
            v-model="href"
            placeholder="https://example.com"
            class="w-full"
            :data-testid="QA_EXTERNAL_LINK_MODAL.URL_INPUT"
            @keyup.enter="onSave"
          />
        </UFormField>
        <LinkOptionsForm v-model="options" />
      </div>
    </template>

    <template #footer>
      <div class="flex justify-between gap-2 w-full">
        <UButton
          v-if="mode === 'edit'"
          color="error"
          variant="ghost"
          :data-testid="QA_EXTERNAL_LINK_MODAL.REMOVE_BTN"
          @click="emit('remove')"
        >
          Remove
        </UButton>
        <div class="flex gap-2 ml-auto">
          <UButton
            color="neutral"
            variant="ghost"
            :data-testid="QA_EXTERNAL_LINK_MODAL.CANCEL_BTN"
            @click="emit('close')"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            :disabled="!validation.ok"
            :data-testid="QA_EXTERNAL_LINK_MODAL.SAVE_BTN"
            @click="onSave"
          >
            Save
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
