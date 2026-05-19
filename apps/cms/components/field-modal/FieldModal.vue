<script setup lang="ts">
import type { FieldFormData, FieldModalProps } from './fieldModal.types';
import { QA_FIELD_MODAL } from './fieldModal.config';

const props = withDefaults(defineProps<FieldModalProps>(), {
  testId: QA_FIELD_MODAL.COMPONENT,
});

const emit = defineEmits<{
  close: [];
  save: [data: FieldFormData];
  delete: [fieldId: string];
}>();

const formName = ref('');
const formIdentifier = ref('');
const identifierTouched = ref(false);
const formType = ref<FieldTypeName>(FIELD_TYPES.TEXT);
const formRequired = ref(false);
const formUnique = ref(false);
const formOptions = ref<unknown>(null);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.mode === 'edit' && props.field) {
        formName.value = props.field.name;
        formIdentifier.value = props.field.identifier;
        formType.value = props.field.type as FieldTypeName;
        formRequired.value = props.field.required;
        formUnique.value = props.field.unique;
        formOptions.value = props.field.options ?? null;
        identifierTouched.value = true;
      } else {
        formName.value = '';
        formIdentifier.value = '';
        formType.value = FIELD_TYPES.TEXT;
        formRequired.value = false;
        formUnique.value = false;
        formOptions.value = null;
        identifierTouched.value = false;
      }
    }
  }
);

watch(formName, (val) => {
  if (props.mode === 'add' && !identifierTouched.value) {
    formIdentifier.value = toCamelCase(val);
  }
});

const canSave = computed(() => {
  if (props.mode === 'add') {
    return formName.value.trim() && formIdentifier.value.trim();
  }
  return formName.value.trim();
});

const showUniqueToggle = computed(
  () =>
    formType.value === FIELD_TYPES.TEXT ||
    formType.value === FIELD_TYPES.NUMBER ||
    formType.value === FIELD_TYPES.ENTRY_TITLE ||
    formType.value === FIELD_TYPES.SLUG
);

const uniqueToggleReadonly = computed(
  () =>
    formType.value === FIELD_TYPES.ENTRY_TITLE ||
    formType.value === FIELD_TYPES.SLUG
);

function handleSave() {
  if (!canSave.value) return;
  emit('save', {
    identifier: formIdentifier.value.trim(),
    name: formName.value.trim(),
    type: formType.value,
    required: formRequired.value,
    unique: uniqueToggleReadonly.value ? true : formUnique.value,
    options: formOptions.value,
  });
}

function handleDelete() {
  if (props.field?.id) {
    emit('delete', props.field.id);
  }
}

function updateOptions(val: unknown) {
  // Merge object-shaped partial updates with the current options so
  // multiple pickers (e.g. RICHTEXT embed + link allow-lists) can each
  // call updateOptions({ singleKey }) without erasing the others.
  const current = formOptions.value;
  if (isObject(val) && isObject(current)) {
    formOptions.value = { ...current, ...val };
    return;
  }
  formOptions.value = val;
}

const canDelete = computed(() => {
  return props.mode === 'edit' && props.field?.type !== FIELD_TYPES.ENTRY_TITLE;
});
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
      <div class="flex items-center gap-2">
        <h3 class="text-lg font-semibold">
          {{ mode === 'add' ? 'Add Field' : 'Edit Field' }}
        </h3>
        <UBadge
          v-if="mode === 'edit'"
          size="sm"
          variant="subtle"
          color="success"
        >
          {{ field?.type }}
        </UBadge>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="conflictAlert"
          color="error"
          icon="i-lucide-alert-circle"
          :title="conflictAlert.message"
          class="mb-2"
        >
          <template #description>
            <ul class="mt-2 space-y-1 text-sm">
              <li v-for="(c, i) in conflictAlert.conflicts" :key="i">
                <span class="font-medium">{{ c.value }}</span>
                <span class="text-muted"> — </span>
                <NuxtLink
                  v-for="(eid, j) in c.entryIds"
                  :key="eid"
                  :to="`/entries/${eid}`"
                  target="_blank"
                  class="underline mr-2"
                >
                  {{ eid.slice(0, 8)
                  }}<span v-if="j < c.entryIds.length - 1">,</span>
                </NuxtLink>
              </li>
            </ul>
          </template>
        </UAlert>

        <!-- Info bar (edit mode only) -->
        <div
          v-if="mode === 'edit'"
          class="flex items-center gap-4 text-sm rounded-lg bg-muted p-3 -mt-1"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-muted">Identifier:</span>
            <span class="font-medium">{{ field?.identifier }}</span>
          </div>
          <USeparator orientation="vertical" class="h-4" />
          <div class="flex items-center gap-1.5">
            <span class="text-muted">Used in:</span>
            <span class="font-medium">{{ entryCount ?? 0 }} entries</span>
          </div>
        </div>

        <UFormField label="Name" required>
          <UInput
            v-model="formName"
            :placeholder="mode === 'add' ? 'e.g. Publish Date' : ''"
            class="w-full"
          />
        </UFormField>

        <!-- Identifier (add mode only) -->
        <UFormField
          v-if="mode === 'add'"
          label="Identifier"
          required
          hint="camelCase, auto-generated"
        >
          <UInput
            v-model="formIdentifier"
            placeholder="e.g. publishDate"
            class="w-full"
            @input="identifierTouched = true"
          />
        </UFormField>

        <!-- Type + Required + Unique row (add mode) -->
        <div v-if="mode === 'add'" class="grid grid-cols-2 gap-4">
          <UFormField label="Type">
            <USelect
              v-model="formType"
              :items="fieldTypeOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label=" ">
            <div class="flex flex-col gap-2">
              <USwitch v-model="formRequired" label="Required" />
              <USwitch
                v-if="showUniqueToggle"
                :model-value="uniqueToggleReadonly ? true : formUnique"
                :disabled="uniqueToggleReadonly"
                label="Unique"
                @update:model-value="formUnique = $event"
              />
            </div>
          </UFormField>
        </div>

        <!-- Required toggle (edit mode — type is read-only) -->
        <UFormField v-if="mode === 'edit'" label="Required">
          <USwitch v-model="formRequired" />
        </UFormField>

        <UFormField v-if="mode === 'edit' && showUniqueToggle" label="Unique">
          <USwitch
            :model-value="uniqueToggleReadonly ? true : formUnique"
            :disabled="uniqueToggleReadonly"
            @update:model-value="formUnique = $event"
          />
          <template #help>
            Entries must have distinct values for this field. Empty values are
            allowed.
          </template>
        </UFormField>

        <!-- Type-specific options slot -->
        <slot
          name="type-options"
          :type="formType"
          :options="formOptions"
          :update-options="updateOptions"
        />

        <!-- Danger zone (edit mode, non-ENTRY_TITLE) -->
        <div v-if="canDelete" class="pt-4">
          <USeparator color="error" />
          <div class="flex items-center justify-between pt-4">
            <div>
              <p class="text-sm font-medium text-red-700 dark:text-red-400">
                Delete this field
              </p>
              <p class="text-xs text-muted">
                Data in {{ entryCount ?? 0 }} entries will be preserved but
                hidden
              </p>
            </div>
            <UButton
              size="sm"
              variant="outline"
              color="error"
              @click="handleDelete"
            >
              Delete
            </UButton>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" @click="emit('close')">Cancel</UButton>
        <UButton :disabled="!canSave" @click="handleSave">
          {{ mode === 'add' ? 'Add Field' : 'Save Changes' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
